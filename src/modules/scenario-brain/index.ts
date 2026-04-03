import { PipelineContext, ModuleResult } from '../../types';
import { FeatureGenerator } from './feature-generator';
import { ClaudeClient } from '../../ai/claude-client';
import { Logger } from '../../utils/logger';

export async function runScenarioBrain(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('ScenarioBrain');

  if (!context.codeAnalysis || !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { moduleName: 'ScenarioBrain', status: 'error', error: 'Missing analysis or auth token' };
  }

  try {
    const generator = new FeatureGenerator();

    // If we have flows from screen detection, use them
    if (context.codeAnalysis.criticalFlows.length > 0) {
      const scenarios = await generator.generateFeatures(
        context.codeAnalysis.industry,
        context.codeAnalysis.criticalFlows,
      );
      context.scenariosBdd = scenarios;
      logger.log('Feature generation complete (from flows)', { scenarios: scenarios.length });
      return { moduleName: 'ScenarioBrain', status: 'success', data: scenarios };
    }

    // Fallback: generate scenarios directly from PR diff using Claude
    logger.log('No flows detected, generating scenarios from PR diff');
    const claude = new ClaudeClient();

    const diffSummary = context.diffFiles
      .slice(0, 15) // limit to 15 files
      .map(f => `${f.status} ${f.path}\n${f.patch?.slice(0, 500) || ''}`)
      .join('\n---\n');

    const framework = context.codeAnalysis.framework || 'native';
    const prompt = `You are a mobile QA expert. Analyze this ${framework} mobile app PR diff and generate Gherkin BDD test scenarios.

The app framework is: ${framework}
Industry: ${context.codeAnalysis.industry || 'generic'}

PR changes:
${diffSummary}

Generate 3-8 realistic Gherkin scenarios that test the CHANGED functionality. Format:

Feature: <feature name>

Scenario: <scenario name>
  Given <precondition>
  When <action>
  Then <expected result>

Focus on:
- User-visible behavior changes
- Edge cases for the changed code
- Platform-specific behavior (Android/iOS)
Only output Gherkin, no explanations.`;

    const response = await claude.prompt(prompt);
    const scenarios = generator.parseResponse(response);

    context.scenariosBdd = scenarios;
    logger.log('Feature generation complete (from diff)', { scenarios: scenarios.length });
    return { moduleName: 'ScenarioBrain', status: 'success', data: scenarios };
  } catch (error) {
    logger.error('Feature generation failed', error);
    return { moduleName: 'ScenarioBrain', status: 'error', error: String(error) };
  }
}
