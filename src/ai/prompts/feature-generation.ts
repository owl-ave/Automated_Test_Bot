function getElementTargetGuidance(framework?: string): string {
  // The runtime ElementResolver fuzzy-matches step targets against the live page source
  // (text/label/contentDesc/name attrs). It does NOT require accessibility IDs — visible
  // labels work fine. So we instruct the model to prefer human-readable labels and only
  // fall back to IDs when an element has no visible text.
  const common =
    '- PREFER the element\'s visible label (button text, field placeholder, screen heading) over an internal id.\n' +
    '- Quote the label exactly as it appears to the user — case and spacing are preserved by the resolver.\n' +
    '- Use accessibility IDs ONLY if the element has no visible text (icon-only buttons, etc.).\n' +
    '- Do NOT invent ids that aren\'t in the listed elements — fall back to the visible label instead.';
  switch (framework) {
    case 'react-native':
      return `${common}\n- For React Native: testID values are valid fallbacks.`;
    case 'swift':
      return `${common}\n- For SwiftUI/UIKit: accessibilityIdentifier and accessibilityLabel are valid fallbacks.`;
    case 'kotlin':
      return `${common}\n- For Android / Jetpack Compose: resource-id, contentDescription, and Modifier.testTag values are valid fallbacks.`;
    case 'flutter':
      return `${common}\n- For Flutter: Semantics labels and Key values are valid fallbacks.`;
    default:
      return common;
  }
}

export function getFeatureGenerationPrompt(industry: string, flowName: string, screenNames: string[], framework?: string, screens?: { name: string; elements: { id: string; type: string; text?: string }[] }[]): string {
  const platformLabel = framework && framework !== 'native' ? ` (${framework})` : '';

  // Build screen context with extracted elements. We surface visible text as the primary
  // identifier when present so the model picks human-readable labels for step targets.
  const screenContext = screenNames.map((name) => {
    const screen = screens?.find((s) => s.name === name);
    if (!screen || screen.elements.length === 0) {
      return `- ${name} (no elements extracted — generate steps using likely visible labels for a ${industry} app on this screen)`;
    }
    const elemList = screen.elements.slice(0, 15).map((e) => {
      const display = e.text ?? e.id;
      const fallbackId = e.text && e.text !== e.id ? `, fallback id: "${e.id}"` : '';
      return `    • "${display}" (${e.type}${fallbackId})`;
    }).join('\n');
    return `- ${name}:\n${elemList}`;
  }).join('\n');

  return `Act as an expert Mobile QA Automation Engineer specializing in Appium and BDD Gherkin.
You are writing test scenarios for a ${industry}${platformLabel} mobile app.

Flow: ${flowName}
Screens Involved: ${screenNames.join(' → ')}

## UI elements available on each screen
${screenContext}

## Output Requirements
Generate realistic scenarios using strict Appium Gherkin mapping:
1. One Happy Path scenario.
2. Two Edge Case scenarios (e.g., validation rules, empty fields, timeouts).
3. One Negative scenario (e.g., invalid inputs, permission denial).

## Appium Gherkin Syntax Rules
You MUST strictly follow these step formats so the Appium parser can execute them.
- TAP: \`When user taps on "<element>"\`
- TYPE: \`And user types "<value>" in "<element>"\`
- SCROLL: \`And user scrolls <up/down>\`
- SWIPE: \`And user swipes <left/right>\`
- WAIT: \`And user waits for "<element>"\`
- ASSERT VISIBLE: \`Then user should see "<element>"\`
- ASSERT TEXT: \`Then text shows "<expectedText>"\`
- BACK: \`And user goes back\`

## Element Target Rules
${getElementTargetGuidance(framework)}

## Multi-Shot Example (visible-label style)
Scenario: Happy Path Login
  Given the app is launched
  And user is on "Login"
  When user types "test@example.com" in "Email"
  And user types "<test_password>" in "Password"
  And user taps on "Sign in"
  And user waits for "Home"
  Then user should see "Home"

Scenario: Invalid Email format
  Given the app is launched
  And user is on "Login"
  When user types "not-an-email" in "Email"
  And user taps on "Sign in"
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
