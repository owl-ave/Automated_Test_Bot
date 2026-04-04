import { PipelineContext, ModuleResult } from '../../types';
import { FeatureGenerator } from './feature-generator';
import { ClaudeClient } from '../../ai/claude-client';
import { Logger } from '../../utils/logger';

function getElementIdRules(framework: string): string {
  switch (framework) {
    case 'react-native':
      return '- For React Native: use testID prop values (e.g., testID="login_button") or component text content';
    case 'swift':
      return '- For iOS/Swift: use accessibilityIdentifier values (preferred), accessibilityLabel, or visible button/label text\n- For SwiftUI: use .accessibilityIdentifier("id") values';
    case 'kotlin':
      return '- For Android/Kotlin: use android:id resource-id values (e.g., "login_button"), android:contentDescription, or visible text\n- For Jetpack Compose: use Modifier.testTag("tag") values';
    case 'flutter':
      return '- For Flutter: use Key values (e.g., Key("login_button")), Semantics labels, or visible text content';
    default:
      return '- Use accessibility IDs, resource-ids, or visible text content from the actual code';
  }
}

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
        context.codeAnalysis.framework,
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
    const prompt = `You are an expert Mobile QA Automation Engineer specializing in Appium and BDD Gherkin.
Analyze this ${framework} mobile app PR diff and generate executable test scenarios.

The app framework is: ${framework}
Industry: ${context.codeAnalysis.industry || 'generic'}

PR changes:
${diffSummary}

## CRITICAL: Appium-Executable Step Syntax
Every step MUST use one of these exact patterns so the Appium automation parser can execute them.
Do NOT write descriptive/abstract steps like "the app is installed" or "the device is in dark mode" — those CANNOT be automated.

Allowed step formats:
- TAP: \`When user taps on "<elementId>"\`
- TYPE: \`And user types "<value>" in "<elementId>"\`
- SCROLL: \`And user scrolls <up/down>\`
- SWIPE: \`And user swipes <left/right>\`
- WAIT: \`And user waits for "<elementId>"\`
- ASSERT VISIBLE: \`Then user should see "<elementId>"\`
- ASSERT TEXT: \`Then text shows "<expectedText>"\`
- BACK: \`And user goes back\`
- LAUNCH (implicit): \`Given the app is launched\` (this is the ONLY valid Given step)

## Element ID Rules
- Use realistic element IDs based on the actual code — never invent abstract IDs like "safe_area_bounds"
${getElementIdRules(framework)}

## Example
Scenario: App renders main screen
  Given the app is launched
  And user waits for "main_screen"
  Then user should see "main_screen"
  And text shows "Welcome"

Scenario: User navigates back from settings
  Given the app is launched
  And user taps on "settings_button"
  And user waits for "settings_screen"
  And user goes back
  Then user should see "main_screen"

Generate 3-8 scenarios that test the CHANGED functionality. Focus on user-visible behavior.
Only output valid Gherkin using the step formats above. No explanations.`;

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
