import { BddScenario, Flow, Screen } from '../../types';
import { ClaudeClient } from '../../ai/claude-client';
import { getFeatureGenerationPrompt } from '../../ai/prompts/feature-generation';
import { Logger } from '../../utils/logger';

export class FeatureGenerator {
  private logger = new Logger('FeatureGenerator');
  private claudeClient: ClaudeClient;

  constructor() {
    this.claudeClient = new ClaudeClient();
  }

  // Run per-flow Claude calls in parallel with a bounded concurrency window so a 20-flow
  // app doesn't take 20x the per-call latency. A hand-rolled pool avoids adding `p-limit`
  // as a dep for just this one use.
  async generateFeatures(
    industry: string,
    flows: Flow[],
    framework?: string,
    allScreens?: Screen[],
  ): Promise<BddScenario[]> {
    const CONCURRENCY = 5;
    const scenarios: BddScenario[] = [];

    const generateOne = async (flow: Flow): Promise<BddScenario[]> => {
      try {
        const flowScreenObjects = allScreens
          ? (flow.screens.map((name) => allScreens.find((s) => s.name === name)).filter(Boolean) as Screen[])
          : [];
        const prompt = getFeatureGenerationPrompt(industry, flow.name, flow.screens, framework, flowScreenObjects);
        const response = await this.claudeClient.analyzeCode('', prompt);
        const parsed = this.parseFeatures(response, flow.name);
        this.logger.log(`Generated ${parsed.length} scenarios for ${flow.name}`);
        return parsed;
      } catch (error) {
        this.logger.warn(`Failed to generate features for ${flow.name}`, error);
        return [];
      }
    };

    for (let i = 0; i < flows.length; i += CONCURRENCY) {
      const batch = flows.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(generateOne));
      for (const list of batchResults) scenarios.push(...list);
    }

    return scenarios;
  }

  parseResponse(response: string, flowName: string = 'PR Changes'): BddScenario[] {
    return this.parseFeatures(response, flowName);
  }

  private parseFeatures(response: string, flowName: string): BddScenario[] {
    const scenarios: BddScenario[] = [];
    // Strip markdown code fences — Claude often wraps Gherkin in ```gherkin ... ```
    const cleaned = response.replace(/```(?:gherkin|feature|cucumber)?\n?/gi, '');
    const lines = cleaned.split('\n');
    let currentScenario: { scenario: string; steps: any[] } | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('Scenario:')) {
        if (currentScenario) {
          this.pushValidated(scenarios, currentScenario, flowName);
        }
        currentScenario = { scenario: trimmed.replace('Scenario:', '').trim(), steps: [] };
      } else if (
        currentScenario &&
        (trimmed.startsWith('Given ') ||
          trimmed.startsWith('When ') ||
          trimmed.startsWith('Then ') ||
          trimmed.startsWith('And '))
      ) {
        const [keyword, ...rest] = trimmed.split(' ');
        currentScenario.steps.push({
          keyword: keyword as any,
          text: rest.join(' '),
        });
      }
    }

    if (currentScenario) {
      this.pushValidated(scenarios, currentScenario, flowName);
    }

    return scenarios;
  }

  // Enforce a sane Gherkin shape:
  //   - scenario name must be non-empty
  //   - at least one step
  //   - the first non-"And" keyword must be Given, then When may follow, then Then
  //   - "And" inherits the previous keyword, so we project it before ordering check
  // Invalid scenarios are dropped with a warning so the downstream test-writer never tries
  // to convert broken Gherkin into Appium code.
  private pushValidated(
    scenarios: BddScenario[],
    candidate: { scenario: string; steps: any[] },
    flowName: string,
  ): void {
    if (!candidate.scenario) {
      this.logger.warn(`Dropping scenario with empty name in flow "${flowName}"`);
      return;
    }
    if (candidate.steps.length === 0) {
      this.logger.warn(`Dropping scenario "${candidate.scenario}" (no steps)`);
      return;
    }

    const projected: string[] = [];
    let last: 'Given' | 'When' | 'Then' | null = null;
    for (const step of candidate.steps) {
      if (step.keyword === 'And') {
        if (!last) {
          this.logger.warn(
            `Dropping scenario "${candidate.scenario}" — starts with "And" (no preceding Given/When/Then)`,
          );
          return;
        }
        projected.push(last);
      } else {
        last = step.keyword;
        projected.push(step.keyword);
      }
    }

    const rank: Record<string, number> = { Given: 0, When: 1, Then: 2 };
    for (let i = 1; i < projected.length; i++) {
      if (rank[projected[i]] < rank[projected[i - 1]]) {
        this.logger.warn(
          `Dropping scenario "${candidate.scenario}" — invalid step order ${projected.join(' → ')}`,
        );
        return;
      }
    }

    scenarios.push({ feature: flowName, scenario: candidate.scenario, steps: candidate.steps });
  }
}
