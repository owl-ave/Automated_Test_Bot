import { Flow, Screen, MaestroFlow, LaunchState, AuthConfig, PreAuthGate } from '../../types';
import { ClaudeClient } from '../../ai/claude-client';
import {
  getMaestroFlowPrompt,
  getMaestroDiffPrompt,
  buildPreAuthGateYaml,
  MaestroPromptCreds,
  MaestroPromptLaunchState,
} from '../../ai/prompts/feature-generation';
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
  launchState?: LaunchState;
  authConfig?: AuthConfig;
}

// Distil AuthConfig into the credential shape the prompt module expects, or
// return undefined when no usable creds are present (so the prompt switches to
// the no-creds branch).
function toPromptCreds(auth?: AuthConfig): MaestroPromptCreds | undefined {
  if (!auth || auth.type === 'none' || auth.type === 'guest') return undefined;
  const creds: MaestroPromptCreds = {};
  if (auth.email) creds.email = auth.email;
  if (auth.password) creds.password = auth.password;
  if (auth.phone) creds.phone = auth.phone;
  if (auth.username) creds.username = auth.username;
  if (!creds.email && !creds.phone && !creds.username) return undefined;
  return creds;
}

function toPromptLaunchState(ls?: LaunchState): MaestroPromptLaunchState | undefined {
  if (!ls) return undefined;
  return {
    initialScreen: ls.initialScreen,
    requiresAuth: ls.requiresAuth,
    authScreens: ls.authScreens,
    postAuthEntry: ls.postAuthEntry,
    preAuthGates: ls.preAuthGates,
  };
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
    const duplicateLabels = computeDuplicateLabels(inputs.screens);
    const launchState = toPromptLaunchState(inputs.launchState);
    const creds = toPromptCreds(inputs.authConfig);

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
          duplicateLabels,
          launchState,
          creds,
        });
        const response = await this.claudeClient.analyzeCode('', prompt);
        const parsed = this.parseFlowsJson(response, flow.name, inputs.appId, inputs.launchState?.preAuthGates);
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
    const duplicateLabels = computeDuplicateLabels(inputs.screens);
    const prompt = getMaestroDiffPrompt({
      industry: inputs.industry,
      framework: inputs.framework,
      diffSummary,
      appId: inputs.appId,
      vocab,
      duplicateLabels,
      launchState: toPromptLaunchState(inputs.launchState),
      creds: toPromptCreds(inputs.authConfig),
    });
    const response = await this.claudeClient.analyzeCode('', prompt);
    return this.parseFlowsJson(response, 'PR Changes', inputs.appId, inputs.launchState?.preAuthGates);
  }

  // The model is asked for raw JSON, but it sometimes still wraps in fences or
  // bookends with prose. Strip those, then JSON.parse strictly. Anything that
  // doesn't look like the expected shape gets dropped with a warning so a
  // single bad item doesn't tank the whole batch.
  parseFlowsJson(
    response: string,
    defaultFeature: string,
    appId: string,
    preAuthGates?: PreAuthGate[],
  ): MaestroFlow[] {
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
      const finalBody = this.ensurePreAuthPreamble(body, preAuthGates, scenario);
      out.push({
        feature,
        scenario,
        appId,
        fileName: `${slugify(scenario)}.yaml`,
        yaml: assembleFlowYaml(appId, finalBody),
        issues: [],
      });
    }
    return out;
  }

  // Belt-and-braces guard: if the AI dropped the cold-launch preamble, splice
  // it in deterministically. We detect "missing" by checking whether the
  // first gate's anchor text or tap label appears anywhere in the body — a
  // minimal heuristic that tolerates the AI rephrasing the preamble's
  // formatting (e.g. quoting style, optional waitForVisible) but catches the
  // common case where the model jumps straight from `launchApp` to the
  // target screen's assertion.
  ensurePreAuthPreamble(body: string, gates: PreAuthGate[] | undefined, scenario: string): string {
    if (!gates || gates.length === 0) return body;

    const gateMarkers = gates.flatMap((g) => {
      const m: string[] = [];
      if (g.waitForVisible) m.push(g.waitForVisible);
      if (g.dismiss.type === 'tap') m.push(g.dismiss.label);
      if (g.dismiss.type === 'tap-id') m.push(g.dismiss.id);
      return m;
    });
    if (gateMarkers.length === 0) return body;

    // If any of the first gate's markers appear in the body, assume the AI
    // honoured the preamble (it may have reordered or expanded steps).
    const firstGate = gates[0];
    const firstGateMarkers: string[] = [];
    if (firstGate.waitForVisible) firstGateMarkers.push(firstGate.waitForVisible);
    if (firstGate.dismiss.type === 'tap') firstGateMarkers.push(firstGate.dismiss.label);
    if (firstGate.dismiss.type === 'tap-id') firstGateMarkers.push(firstGate.dismiss.id);
    const hasFirstGate = firstGateMarkers.some((m) => body.includes(m));
    if (hasFirstGate) return body;

    const preambleYaml = buildPreAuthGateYaml(gates);
    if (!preambleYaml) return body;

    this.logger.warn('Prepended cold-launch preamble to AI-generated flow', {
      scenario,
      gates: gates.map((g) => g.screen),
    });

    // Splice the preamble in immediately after `- launchApp`. If the body
    // doesn't start with launchApp (rare — model misbehaviour), prepend
    // `launchApp\n<preamble>\n` and rely on the validator to catch any
    // remaining issues.
    const launchAppRegex = /^(\s*-\s*launchApp\s*\n?)/;
    const match = body.match(launchAppRegex);
    if (match) {
      const before = match[0];
      const after = body.slice(before.length);
      const beforeWithNewline = before.endsWith('\n') ? before : `${before}\n`;
      return `${beforeWithNewline}${preambleYaml}\n${after}`;
    }
    return `- launchApp\n${preambleYaml}\n${body}`;
  }
}

// Maestro flow files have two YAML documents: the config block (appId) then
// the commands sequence, separated by `---`. The model emits only the
// commands sequence so the appId-substitution stays under our control.
function assembleFlowYaml(appId: string, body: string): string {
  const trimmed = body.replace(/^---\s*/m, '').trim();
  return `appId: ${JSON.stringify(appId)}\n---\n${trimmed}\n`;
}

// Counts every distinct element label across the whole screen catalog and
// returns those that appear ≥3 times. The validator hard-blocks flows that
// tap on labels with count ≥ 5; the prompt steers the model away from labels
// at count ≥ 3 so it falls back to id-based or screen-anchored taps before
// the validator has to reject the output.
const DUPLICATE_LABEL_THRESHOLD = 3;
function computeDuplicateLabels(screens: Screen[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const screen of screens) {
    for (const el of screen.elements) {
      // Match the validator's lookup pool (text + ids), case-insensitive.
      const candidates = [el.text, el.accessibilityId, el.resourceId, el.id].filter((s): s is string => Boolean(s));
      const seenInElement = new Set<string>();
      for (const c of candidates) {
        const key = c.toLowerCase();
        if (seenInElement.has(key)) continue;
        seenInElement.add(key);
        counts.set(c, (counts.get(c) || 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= DUPLICATE_LABEL_THRESHOLD)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
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
