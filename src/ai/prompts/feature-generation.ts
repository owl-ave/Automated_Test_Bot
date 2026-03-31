export function getFeatureGenerationPrompt(industry: string, flowName: string, screenNames: string[]): string {
  return `Act as an expert Mobile QA Automation Engineer specializing in Appium and BDD Gherkin.
You are writing test scenarios for a ${industry} mobile app.

Flow: ${flowName}
Screens Involved: ${screenNames.join(' → ')}

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

## Multi-Shot Example
Scenario: Happy Path Login
  Given the app is launched
  And user is on "login_screen"
  When user types "test@example.com" in "email_input"
  And user types "password123" in "password_input"
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
