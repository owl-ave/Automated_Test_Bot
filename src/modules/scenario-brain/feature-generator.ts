import { BddScenario, Flow } from '../../types';
import { ClaudeClient } from '../../ai/claude-client';
import { getFeatureGenerationPrompt } from '../../ai/prompts/feature-generation';
import { Logger } from '../../utils/logger';

export class FeatureGenerator {
  private logger = new Logger('FeatureGenerator');
  private claudeClient: ClaudeClient;

  constructor() {
    this.claudeClient = new ClaudeClient();
  }

  async generateFeatures(industry: string, flows: Flow[]): Promise<BddScenario[]> {
    const scenarios: BddScenario[] = [];

    for (const flow of flows) {
      try {
        const prompt = getFeatureGenerationPrompt(industry, flow.name, flow.screens);
        const response = await this.claudeClient.analyzeCode('', prompt);

        const parsed = this.parseFeatures(response, flow.name);
        scenarios.push(...parsed);
        this.logger.log(`Generated ${parsed.length} scenarios for ${flow.name}`);
      } catch (error) {
        this.logger.warn(`Failed to generate features for ${flow.name}`, error);
      }
    }

    return scenarios;
  }

  parseResponse(response: string, flowName: string = 'PR Changes'): BddScenario[] {
    return this.parseFeatures(response, flowName);
  }

  private parseFeatures(response: string, flowName: string): BddScenario[] {
    const scenarios: BddScenario[] = [];
    const lines = response.split('\n');
    let currentScenario: { scenario: string; steps: any[] } | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('Scenario:')) {
        if (currentScenario) {
          scenarios.push({
            feature: flowName,
            scenario: currentScenario.scenario,
            steps: currentScenario.steps,
          });
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
      scenarios.push({
        feature: flowName,
        scenario: currentScenario.scenario,
        steps: currentScenario.steps,
      });
    }

    return scenarios;
  }
}
