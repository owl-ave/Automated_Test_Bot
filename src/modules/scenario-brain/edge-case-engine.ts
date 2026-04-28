import { BddScenario, CodeAnalysis, GherkinStep } from '../../types';
import { ClaudeClient } from '../../ai/claude-client';
import { Logger } from '../../utils/logger';

export class EdgeCaseEngine {
  private logger = new Logger('EdgeCaseEngine');

  // Edge cases come from two independent sources:
  //   1. generateAIEdgeCases  — Claude-generated scenarios for this specific app
  //   2. generatePatternEdgeCases — deterministic templated scenarios (hardcoded
  //      boundary/permission/offline checks). These ship even when Claude is
  //      unavailable so every run has a baseline edge-case suite.
  // Do not relabel pattern scenarios as "AI-generated" — they are explicitly not.
  async generateEdgeCases(codeAnalysis: CodeAnalysis, claudeClient: ClaudeClient): Promise<BddScenario[]> {
    const [aiScenarios, patternScenarios] = await Promise.all([
      this.generateAIEdgeCases(codeAnalysis, claudeClient),
      Promise.resolve(this.generatePatternEdgeCases(codeAnalysis)),
    ]);

    const scenarios: BddScenario[] = [...aiScenarios, ...patternScenarios];

    this.logger.log('Edge cases generated', {
      aiGenerated: aiScenarios.length,
      patternGenerated: patternScenarios.length,
      total: scenarios.length,
    });

    return scenarios;
  }

  private async generateAIEdgeCases(codeAnalysis: CodeAnalysis, claudeClient: ClaudeClient): Promise<BddScenario[]> {
    const prompt = this.buildEdgeCasePrompt(codeAnalysis);

    try {
      const response = await claudeClient.analyzeCode('', prompt);
      return this.parseGherkinResponse(response);
    } catch (error) {
      this.logger.error('AI edge case generation failed', error);
      return [];
    }
  }

  private buildEdgeCasePrompt(codeAnalysis: CodeAnalysis): string {
    const screenSummary = codeAnalysis.screens
      .map((s) => {
        const elements = s.elements.map((e) => `${e.type}(${e.id}${e.text ? `: "${e.text}"` : ''})`).join(', ');
        return `- ${s.name} [${s.type}]: ${elements || 'no elements mapped'}`;
      })
      .join('\n');

    const apiSummary = codeAnalysis.apiEndpoints.map((e) => `${e.method} ${e.path}`).join('\n');

    const flowSummary = codeAnalysis.criticalFlows
      .map((f) => `- ${f.name} (${f.priority}): ${f.screens.join(' → ')}`)
      .join('\n');

    return `Analyze this ${codeAnalysis.framework} mobile app and generate edge case BDD scenarios.

Screens:
${screenSummary}

API Endpoints:
${apiSummary || 'None discovered'}

Critical Flows:
${flowSummary || 'None identified'}

Industry: ${codeAnalysis.industry}

Generate edge case scenarios covering:
1. Boundary values for input fields (min/max length, special characters, unicode)
2. Network timeout/error during API calls
3. Session expiration mid-flow
4. Concurrent action conflicts (double-tap, rapid navigation)
5. Device-specific: low memory, orientation change, keyboard dismiss
6. Permission denial (camera, location, storage, notifications)
7. Empty states (no data, no results, empty cart, no internet)
8. Pagination limits (first page, last page, large dataset)
9. Back navigation from each flow step
10. App backgrounding and resume at each critical step

Format each as valid Gherkin:
Scenario: <descriptive name>
  Given <precondition>
  When <action triggering edge case>
  Then <expected behavior>

Return ONLY Gherkin scenarios, no explanations.`;
  }

  private generatePatternEdgeCases(codeAnalysis: CodeAnalysis): BddScenario[] {
    const scenarios: BddScenario[] = [];

    for (const screen of codeAnalysis.screens) {
      // Text input edge cases
      const textInputs = screen.elements.filter(
        (e) => /input|text|field|edit/i.test(e.type) || /input|text|field|edit/i.test(e.id),
      );

      for (const input of textInputs) {
        const fieldName = input.text || input.id || 'field';

        scenarios.push(
          this.buildScenario(`${screen.name} Edge Cases`, `Empty ${fieldName} submission`, [
            { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
            { keyword: 'When', text: `the user leaves the ${fieldName} field empty` },
            { keyword: 'And', text: 'the user taps the submit button' },
            { keyword: 'Then', text: 'the user should see a validation error for the required field' },
          ]),
        );

        scenarios.push(
          this.buildScenario(`${screen.name} Edge Cases`, `Maximum length input in ${fieldName}`, [
            { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
            { keyword: 'When', text: `the user enters 256 characters in the ${fieldName} field` },
            { keyword: 'Then', text: 'the input should be truncated or a max length error should appear' },
          ]),
        );

        // Email-specific validation
        if (/email/i.test(fieldName) || /email/i.test(input.id)) {
          scenarios.push(
            this.buildScenario(`${screen.name} Edge Cases`, `Invalid email format in ${fieldName}`, [
              { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
              { keyword: 'When', text: `the user enters "not-an-email" in the ${fieldName} field` },
              { keyword: 'And', text: 'the user taps the submit button' },
              { keyword: 'Then', text: 'the user should see an email format validation error' },
            ]),
          );
        }

        // Password-specific edge cases
        if (/password|pass/i.test(fieldName) || /password|pass/i.test(input.id)) {
          scenarios.push(
            this.buildScenario(`${screen.name} Edge Cases`, `Weak password in ${fieldName}`, [
              { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
              { keyword: 'When', text: `the user enters "123" in the ${fieldName} field` },
              { keyword: 'And', text: 'the user taps the submit button' },
              { keyword: 'Then', text: 'the user should see a password strength warning' },
            ]),
          );
        }
      }

      // List/scroll edge cases
      const listElements = screen.elements.filter(
        (e) => /list|recycler|scroll|flatlist|collection/i.test(e.type) || /list|recycler|scroll/i.test(e.id),
      );

      for (const list of listElements) {
        scenarios.push(
          this.buildScenario(`${screen.name} Edge Cases`, `Empty ${list.id || 'list'} state`, [
            { keyword: 'Given', text: `the user is on the ${screen.name} screen with no data` },
            { keyword: 'Then', text: 'the user should see an empty state illustration or message' },
          ]),
        );

        scenarios.push(
          this.buildScenario(`${screen.name} Edge Cases`, `Pull to refresh on ${list.id || 'list'}`, [
            { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
            { keyword: 'When', text: 'the user pulls down to refresh' },
            { keyword: 'Then', text: 'the list should reload with updated data' },
          ]),
        );
      }

      // Button rapid-tap edge cases
      const buttons = screen.elements.filter(
        (e) => /button|btn|submit|confirm|save|send/i.test(e.type) || /button|btn|submit|confirm|save|send/i.test(e.id),
      );

      for (const button of buttons) {
        const buttonName = button.text || button.id || 'button';
        scenarios.push(
          this.buildScenario(`${screen.name} Edge Cases`, `Rapid double-tap on ${buttonName}`, [
            { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
            { keyword: 'When', text: `the user rapidly taps the ${buttonName} button twice` },
            { keyword: 'Then', text: 'the action should only execute once' },
            { keyword: 'And', text: 'no duplicate submission should occur' },
          ]),
        );
      }
    }

    // Network edge cases for flows with API calls
    if (codeAnalysis.apiEndpoints.length > 0) {
      for (const flow of codeAnalysis.criticalFlows) {
        scenarios.push(
          this.buildScenario(`${flow.name} Network Edge Cases`, `Network timeout during ${flow.name}`, [
            { keyword: 'Given', text: `the user is in the ${flow.name} flow` },
            { keyword: 'And', text: 'the network connection is extremely slow' },
            { keyword: 'When', text: 'the user performs the main action' },
            { keyword: 'Then', text: 'the user should see a loading indicator' },
            { keyword: 'And', text: 'a timeout error should appear after the threshold' },
          ]),
        );

        scenarios.push(
          this.buildScenario(`${flow.name} Network Edge Cases`, `Network loss mid-${flow.name}`, [
            { keyword: 'Given', text: `the user is midway through the ${flow.name} flow` },
            { keyword: 'When', text: 'the network connection is lost' },
            { keyword: 'Then', text: 'the user should see an offline error message' },
            { keyword: 'And', text: 'no data should be lost' },
          ]),
        );
      }
    }

    // App lifecycle edge cases
    for (const flow of codeAnalysis.criticalFlows.filter((f) => f.priority === 'critical' || f.priority === 'high')) {
      scenarios.push(
        this.buildScenario(`${flow.name} Lifecycle Edge Cases`, `App backgrounded during ${flow.name}`, [
          { keyword: 'Given', text: `the user is midway through the ${flow.name} flow` },
          { keyword: 'When', text: 'the user switches to another app and returns after 30 seconds' },
          { keyword: 'Then', text: 'the app should resume at the same step' },
          { keyword: 'And', text: 'entered data should be preserved' },
        ]),
      );

      scenarios.push(
        this.buildScenario(`${flow.name} Lifecycle Edge Cases`, `Back navigation during ${flow.name}`, [
          { keyword: 'Given', text: `the user has progressed to step 2 of the ${flow.name} flow` },
          { keyword: 'When', text: 'the user presses the back button' },
          { keyword: 'Then', text: 'the user should return to the previous step' },
          { keyword: 'And', text: 'previously entered data should be retained' },
        ]),
      );
    }

    return scenarios;
  }

  private buildScenario(feature: string, scenario: string, steps: GherkinStep[]): BddScenario {
    return { feature, scenario, steps };
  }

  private parseGherkinResponse(response: string): BddScenario[] {
    const scenarios: BddScenario[] = [];
    const lines = response.split('\n');
    let currentFeature = 'AI Edge Cases';
    let currentScenario: { scenario: string; steps: GherkinStep[] } | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('Feature:')) {
        currentFeature = trimmed.replace('Feature:', '').trim();
      } else if (trimmed.startsWith('Scenario:')) {
        if (currentScenario && currentScenario.steps.length > 0) {
          scenarios.push({ feature: currentFeature, ...currentScenario });
        }
        currentScenario = { scenario: trimmed.replace('Scenario:', '').trim(), steps: [] };
      } else if (currentScenario) {
        const stepMatch = trimmed.match(/^(Given|When|Then|And|But)\s+(.+)/);
        if (stepMatch) {
          currentScenario.steps.push({
            keyword: stepMatch[1] as GherkinStep['keyword'],
            text: stepMatch[2],
          });
        }
      }
    }

    if (currentScenario && currentScenario.steps.length > 0) {
      scenarios.push({ feature: currentFeature, ...currentScenario });
    }

    return scenarios;
  }
}
