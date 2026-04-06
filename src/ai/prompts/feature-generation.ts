function getElementIdGuidance(framework?: string): string {
  switch (framework) {
    case 'react-native':
      return '- Use testID prop values (e.g., testID="login_button") or component text content';
    case 'swift':
      return '- Use accessibilityIdentifier values (preferred), accessibilityLabel, or visible text\n- For SwiftUI views: use .accessibilityIdentifier("id") values';
    case 'kotlin':
      return '- Use android:id resource-id values (e.g., "login_button"), android:contentDescription, or visible text\n- For Jetpack Compose: use Modifier.testTag("tag") values';
    case 'flutter':
      return '- Use Key values (e.g., Key("login_button")), Semantics labels, or visible text content';
    default:
      return '- Use accessibility IDs, resource-ids, or visible text from the actual code';
  }
}

export function getFeatureGenerationPrompt(industry: string, flowName: string, screenNames: string[], framework?: string, screens?: { name: string; elements: { id: string; type: string; text?: string }[] }[]): string {
  const platformLabel = framework && framework !== 'native' ? ` (${framework})` : '';

  // Build screen context with actual element IDs extracted from code
  const screenContext = screenNames.map((name) => {
    const screen = screens?.find((s) => s.name === name);
    if (!screen || screen.elements.length === 0) return `- ${name} (no elements extracted)`;
    const elemList = screen.elements.slice(0, 15).map((e) => `    • "${e.id}" (${e.type}${e.text ? `, text: "${e.text}"` : ''})`).join('\n');
    return `- ${name}:\n${elemList}`;
  }).join('\n');

  return `Act as an expert Mobile QA Automation Engineer specializing in Appium and BDD Gherkin.
You are writing test scenarios for a ${industry}${platformLabel} mobile app.

Flow: ${flowName}
Screens Involved: ${screenNames.join(' → ')}

## Actual UI Elements Found in Code (use THESE exact IDs — do not invent new ones)
${screenContext}

## Output Requirements
Generate realistic scenarios using strict Appium Gherkin mapping:
1. One Happy Path scenario.
2. Two Edge Case scenarios (e.g., validation rules, empty fields, timeouts).
3. One Negative scenario (e.g., invalid inputs, permission denial).

## Appium Gherkin Syntax Rules
You MUST strictly follow these step formats so the Appium parser can execute them.
- TAP: \`When user taps on "<elementId>"\`
- TYPE: \`And user types "<value>" in "<elementId>"\`
- SCROLL: \`And user scrolls <up/down>\`
- SWIPE: \`And user swipes <left/right>\`
- WAIT: \`And user waits for "<elementId>"\`
- ASSERT VISIBLE: \`Then user should see "<elementId>"\`
- ASSERT TEXT: \`Then text shows "<expectedText>"\`
- BACK: \`And user goes back\`

## Element ID Rules
${getElementIdGuidance(framework)}

## Multi-Shot Example
Scenario: Happy Path Login
  Given the app is launched
  And user is on "login_screen"
  When user types "test@example.com" in "email_input"
  And user types "<test_password>" in "password_input"
  And user taps on "submit_button"
  And user waits for "home_dashboard"
  Then user should see "home_dashboard"

Scenario: Invalid Email format
  Given the app is launched
  And user is on "login_screen"
  When user types "not-an-email" in "email_input"
  And user taps on "submit_button"
  Then text shows "Invalid email format"

Analyze the flow and generate optimal scenarios.
Return ONLY valid Gherkin syntax without conversational text.`;
}

export function getFeatureValidationPrompt(feature: string): string {
  return `Validate the following Gherkin feature file against standard Appium syntax mapping.
Check for undefined variables, hallucinated complex steps (e.g., "Then the server responds with 200" which a client-side UI test cannot check directly), and missing Given closures.

Feature File:
${feature}

Output exactly in JSON format:
{
  "valid": <boolean>,
  "errors": ["list of strings if any"],
  "suggested_fix": "<corrected gherkin string if invalid>"
}`;
}
