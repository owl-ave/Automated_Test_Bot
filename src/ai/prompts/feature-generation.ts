// Maestro flow generation prompts. The bot used to ask Claude for Gherkin and
// then convert it to Maestro YAML — now we go straight to Maestro to drop a
// lossy hop and let the AI use Maestro's full grammar.

export interface MaestroPromptScreen {
  name: string;
  elements: { id: string; type: string; text?: string }[];
}

const SUPPORTED_COMMANDS_REFERENCE = `## Supported Maestro commands (use ONLY these)
- launchApp                              # always the first command
- tapOn: "<visible label>"               # tap a button / element by what the user sees
- inputText: "<value>"                   # type into the currently focused field (precede with tapOn on the field)
- assertVisible: "<visible label>"       # verify an element is on screen
- assertNotVisible: "<visible label>"    # verify an element is not on screen
- extendedWaitUntil:
    visible: "<visible label>"
    timeout: 10000                       # wait up to N ms for element to appear
- swipe:
    direction: LEFT | RIGHT | UP | DOWN
- scroll                                 # single scroll step
- scrollUntilVisible:
    element:
      text: "<visible label>"
- back                                   # OS back button (Android)
- takeScreenshot
- pressKey: HOME | ENTER | BACK
- hideKeyboard
- eraseText`;

const FLOW_RULES = `## Flow rules
- The flow's first command MUST be \`launchApp\`.
- Every flow MUST contain at least one \`assertVisible\` / \`assertNotVisible\`.
- Use only the visible labels listed for each screen — never invent labels.
- Quote labels exactly as they appear (case + spacing matter).
- For text inputs: emit \`tapOn\` on the field FIRST, then \`inputText\` on the next line.
- Use only test-data emails (\`@example.com\`, \`@test.com\`) and 555-01XX phones — never real PII or production credentials.
- Keep flows short and focused (8–15 commands typical). Long flows are fragile.`;

const OUTPUT_FORMAT = `## Output format
Return ONLY a JSON array. No markdown fences, no prose. Each item:
{
  "feature": "<feature group name, e.g. 'Auth'>",
  "scenario": "<short human description, e.g. 'User signs in successfully'>",
  "yaml": "<Maestro flow body — the commands list ONLY, NOT the appId block. Start at '- launchApp' and end with the final command. Use real newlines (\\n).>"
}

The bot will prepend \`appId: <appId>\\n---\\n\` to your YAML before submission. Do not include the config block yourself.`;

export function getMaestroFlowPrompt(args: {
  industry: string;
  flowName: string;
  screenNames: string[];
  framework?: string;
  screens: MaestroPromptScreen[];
  appId: string;
}): string {
  const platform = args.framework && args.framework !== 'native' ? ` (${args.framework})` : '';

  const screenContext = args.screenNames
    .map((name) => {
      const screen = args.screens.find((s) => s.name === name);
      if (!screen || screen.elements.length === 0) {
        return `- ${name} — no elements extracted; reference likely visible labels for a ${args.industry} app on this screen.`;
      }
      const elemList = screen.elements
        .slice(0, 20)
        .map((e) => {
          const display = e.text ?? e.id;
          return `    • "${display}" (${e.type})`;
        })
        .join('\n');
      return `- ${name}:\n${elemList}`;
    })
    .join('\n');

  return `You are an expert Mobile QA Automation Engineer. Generate Maestro flow YAML for a ${args.industry}${platform} mobile app.

Flow: ${args.flowName}
Screens involved: ${args.screenNames.join(' → ')}
App identifier: ${args.appId}

## Visible labels available per screen
${screenContext}

${SUPPORTED_COMMANDS_REFERENCE}

${FLOW_RULES}

## Required scenarios for this flow
1. One Happy Path scenario.
2. Two Edge Case scenarios (validation rules, empty fields, timeouts, etc.).
3. One Negative scenario (invalid inputs, permission denial, etc.).

## Worked example
[
  {
    "feature": "Auth",
    "scenario": "User signs in with valid credentials",
    "yaml": "- launchApp\\n- extendedWaitUntil:\\n    visible: \\"Sign in\\"\\n    timeout: 10000\\n- tapOn: \\"Email\\"\\n- inputText: \\"user@example.com\\"\\n- tapOn: \\"Password\\"\\n- inputText: \\"correct-horse-battery\\"\\n- tapOn: \\"Sign in\\"\\n- assertVisible: \\"Welcome\\""
  },
  {
    "feature": "Auth",
    "scenario": "User sees error on wrong password",
    "yaml": "- launchApp\\n- tapOn: \\"Email\\"\\n- inputText: \\"user@example.com\\"\\n- tapOn: \\"Password\\"\\n- inputText: \\"wrong-pass\\"\\n- tapOn: \\"Sign in\\"\\n- assertVisible: \\"Invalid credentials\\""
  }
]

${OUTPUT_FORMAT}`;
}

export function getMaestroDiffPrompt(args: {
  industry: string;
  framework: string;
  diffSummary: string;
  appId: string;
  vocab: { id: string; type: string; text?: string }[];
}): string {
  const vocabList =
    args.vocab.length === 0
      ? '(no element vocabulary available — use realistic visible labels for a ' + args.industry + ' app)'
      : args.vocab
          .slice(0, 40)
          .map((e) => `  • "${e.text ?? e.id}" (${e.type})`)
          .join('\n');

  return `You are an expert Mobile QA Automation Engineer. Generate Maestro flow YAML to test a ${args.framework} ${args.industry} app PR.

App identifier: ${args.appId}

## Visible labels available across the app
${vocabList}

## PR changes
${args.diffSummary}

${SUPPORTED_COMMANDS_REFERENCE}

${FLOW_RULES}

Generate 3–8 flows that exercise the changed functionality. Focus on user-visible behaviour.

${OUTPUT_FORMAT}`;
}
