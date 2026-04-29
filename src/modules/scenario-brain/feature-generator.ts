import { Flow, Screen, MaestroFlow } from '../../types';
import { ClaudeClient } from '../../ai/claude-client';
import { getMaestroFlowPrompt, getMaestroDiffPrompt } from '../../ai/prompts/feature-generation';
import { Logger } from '../../utils/logger';

// Generates Maestro flow YAML by direct AI call. Replaces the old Gherkin
// generator — there's no intermediate BDD step now. The AI is shown the
// supported Maestro grammar + screen vocabulary and asked for a JSON array of
// `{feature, scenario, yaml}` objects, which we hydrate into MaestroFlow.

export interface FeatureGenInputs {
  industry: string;
  framework: string;
  screens: Screen[];
  appId: string;
}

export class MaestroAuthor {
  private logger = new Logger('MaestroAuthor');
  private claudeClient: ClaudeClient;

  constructor() {
    this.claudeClient = new ClaudeClient();
  }

  // Runs per-flow prompts in parallel with a small concurrency window so a
  // 20-flow app doesn't 20× the per-call latency.
  async generateFromFlows(flows: Flow[], inputs: FeatureGenInputs): Promise<MaestroFlow[]> {
    const CONCURRENCY = 5;
    const out: MaestroFlow[] = [];

    const generateOne = async (flow: Flow): Promise<MaestroFlow[]> => {
      try {
        const flowScreens: Screen[] = flow.screens
          .map((name) => inputs.screens.find((s) => s.name === name))
          .filter((s): s is Screen => Boolean(s));
        const prompt = getMaestroFlowPrompt({
          industry: inputs.industry,
          flowName: flow.name,
          screenNames: flow.screens,
          framework: inputs.framework,
          screens: flowScreens.map((s) => ({ name: s.name, elements: s.elements })),
          appId: inputs.appId,
        });
        const response = await this.claudeClient.analyzeCode('', prompt);
        const parsed = this.parseFlowsJson(response, flow.name, inputs.appId);
        this.logger.log(`Generated ${parsed.length} flows for ${flow.name}`);
        return parsed;
      } catch (error) {
        this.logger.warn(`Failed to generate flows for ${flow.name}`, error);
        return [];
      }
    };

    for (let i = 0; i < flows.length; i += CONCURRENCY) {
      const batch = flows.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(generateOne));
      for (const list of batchResults) out.push(...list);
    }

    return out;
  }

  async generateFromDiff(
    diffSummary: string,
    inputs: FeatureGenInputs,
  ): Promise<MaestroFlow[]> {
    const vocab = inputs.screens.flatMap((s) => s.elements);
    const prompt = getMaestroDiffPrompt({
      industry: inputs.industry,
      framework: inputs.framework,
      diffSummary,
      appId: inputs.appId,
      vocab,
    });
    const response = await this.claudeClient.analyzeCode('', prompt);
    return this.parseFlowsJson(response, 'PR Changes', inputs.appId);
  }

  // The model is asked for raw JSON, but it sometimes still wraps in fences or
  // bookends with prose. Strip those, then JSON.parse strictly. Anything that
  // doesn't look like the expected shape gets dropped with a warning so a
  // single bad item doesn't tank the whole batch.
  parseFlowsJson(response: string, defaultFeature: string, appId: string): MaestroFlow[] {
    const cleaned = response
      .replace(/```(?:json|yaml|yml)?\n?/gi, '')
      .replace(/```/g, '')
      .trim();

    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end <= start) {
      this.logger.warn('Model returned no JSON array — dropping output');
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch (err) {
      this.logger.warn('Failed to parse JSON from model', { error: String(err) });
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const out: MaestroFlow[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as { feature?: unknown; scenario?: unknown; yaml?: unknown };
      const feature = typeof obj.feature === 'string' && obj.feature ? obj.feature : defaultFeature;
      const scenario = typeof obj.scenario === 'string' && obj.scenario ? obj.scenario : '';
      const body = typeof obj.yaml === 'string' ? obj.yaml.trim() : '';
      if (!scenario || !body) {
        this.logger.warn('Skipping malformed flow', { feature, scenario, hasBody: Boolean(body) });
        continue;
      }
      out.push({
        feature,
        scenario,
        appId,
        fileName: `${slugify(scenario)}.yaml`,
        yaml: assembleFlowYaml(appId, body),
        issues: [],
      });
    }
    return out;
  }
}

// Maestro flow files have two YAML documents: the config block (appId) then
// the commands sequence, separated by `---`. The model emits only the
// commands sequence so the appId-substitution stays under our control.
function assembleFlowYaml(appId: string, body: string): string {
  const trimmed = body.replace(/^---\s*/m, '').trim();
  return `appId: ${JSON.stringify(appId)}\n---\n${trimmed}\n`;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'flow'
  );
}
