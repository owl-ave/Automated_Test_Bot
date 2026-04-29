// Maestro flow generation prompts. The bot used to ask Claude for Gherkin and
// then convert it to Maestro YAML — now we go straight to Maestro to drop a
// lossy hop and let the AI use Maestro's full grammar.

export interface MaestroPromptScreen {
  name: string;
  elements: { id: string; type: string; text?: string }[];
}

// Subset of LaunchState we surface in prompts. Decoupled from the full type so
// the prompt module doesn't need to import from types.ts (avoids cycles).
export interface MaestroPromptLaunchState {
  initialScreen: string;
  requiresAuth: boolean;
  authScreens: string[];
  postAuthEntry?: string;
}

export interface MaestroPromptCreds {
  email?: string;
  password?: string;
  phone?: string;
  username?: string;
}

const SUPPORTED_COMMANDS_REFERENCE = `## Supported Maestro commands (use ONLY these)
- launchApp                              # always the first command
- tapOn: "<visible label>"               # ONLY when the label is unique across the app
- tapOn:                                 # PREFERRED when the label appears more than once
    id: "<accessibilityId>"              # exact accessibility identifier
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
- pressKey: HOME | ENTER | BACK
- hideKeyboard
- eraseText`;

const FLOW_RULES = `## Flow rules
- The flow's first command MUST be \`launchApp\`.
- Every flow MUST contain at least one \`assertVisible\` / \`assertNotVisible\`.
- Use only the visible labels listed for each screen — never invent labels.
- Quote labels exactly as they appear (case + spacing matter).
- **Ambiguity rule:** if a label appears in the "Highly ambiguous labels" list, you
  MUST NOT tap it as a plain string. Either use \`tapOn: { id: "<accessibilityId>" }\`
  with an id from the screen's element list, OR confirm screen context first via
  \`extendedWaitUntil: { visible: "<unique screen heading>", timeout: 10000 }\` and
  then tap a UNIQUE label nearby. If neither is possible, skip that interaction.
- For text inputs: emit \`tapOn\` on the field FIRST, then \`inputText\` on the next line.
- **NEVER emit a bare command for these — Maestro will reject the whole suite:**
  \`tapOn\`, \`inputText\`, \`assertVisible\`, \`assertNotVisible\`, \`extendedWaitUntil\`,
  \`swipe\`, \`scrollUntilVisible\`, \`pressKey\`, \`takeScreenshot\`. Always include a value.
- **Empty-field negative tests:** to test "user submits empty field" do NOT emit
  \`- inputText\` with no value (that's invalid YAML for Maestro). Instead, either
  (a) skip the inputText step entirely so the field stays empty, or (b) emit
  \`- eraseText\` to clear an existing value before submitting.
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
  duplicateLabels?: { label: string; count: number }[];
  launchState?: MaestroPromptLaunchState;
  creds?: MaestroPromptCreds;
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
          const idHint = e.id && e.text && e.id !== e.text.replace(/\s+/g, '_').toLowerCase() ? ` id="${e.id}"` : '';
          return `    • "${display}" (${e.type})${idHint}`;
        })
        .join('\n');
      return `- ${name}:\n${elemList}`;
    })
    .join('\n');

  const dupSection = formatDuplicateLabelsSection(args.duplicateLabels);
  const launchSection = formatLaunchStateSection(args.launchState, args.creds, args.screenNames);

  return `You are an expert Mobile QA Automation Engineer. Generate Maestro flow YAML for a ${args.industry}${platform} mobile app.

Flow: ${args.flowName}
Screens involved: ${args.screenNames.join(' → ')}
App identifier: ${args.appId}
${launchSection}
## Visible labels available per screen
${screenContext}
${dupSection}
${SUPPORTED_COMMANDS_REFERENCE}

${FLOW_RULES}

## Required scenarios for this flow
Generate exactly ONE Happy Path scenario for this flow. Keep it focused and reliable — edge cases and negative tests will be added in a later pass once the happy path passes consistently.

## Worked example
[
  {
    "feature": "Auth",
    "scenario": "User signs in with valid credentials",
    "yaml": "- launchApp\\n- extendedWaitUntil:\\n    visible: \\"Sign in\\"\\n    timeout: 10000\\n- tapOn: \\"Email\\"\\n- inputText: \\"user@example.com\\"\\n- tapOn: \\"Password\\"\\n- inputText: \\"correct-horse-battery\\"\\n- tapOn: \\"Sign in\\"\\n- assertVisible: \\"Welcome\\""
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
  duplicateLabels?: { label: string; count: number }[];
  launchState?: MaestroPromptLaunchState;
  creds?: MaestroPromptCreds;
}): string {
  const vocabList =
    args.vocab.length === 0
      ? '(no element vocabulary available — use realistic visible labels for a ' + args.industry + ' app)'
      : args.vocab
          .slice(0, 40)
          .map((e) => `  • "${e.text ?? e.id}" (${e.type})`)
          .join('\n');

  const dupSection = formatDuplicateLabelsSection(args.duplicateLabels);
  const launchSection = formatLaunchStateSection(args.launchState, args.creds);

  return `You are an expert Mobile QA Automation Engineer. Generate Maestro flow YAML to test a ${args.framework} ${args.industry} app PR.

App identifier: ${args.appId}
${launchSection}
## Visible labels available across the app
${vocabList}
${dupSection}
## PR changes
${args.diffSummary}

${SUPPORTED_COMMANDS_REFERENCE}

${FLOW_RULES}

Generate 3–5 short flows that exercise the changed functionality. One Happy Path per distinct change. Keep flows tight (8–15 commands).

${OUTPUT_FORMAT}`;
}

// Renders the launch-state + auth-handling section. The presence/absence of
// credentials drives one of three modes:
//   1. requiresAuth + creds → emit explicit auth prefix + login steps
//   2. requiresAuth + no creds → instruct model to ONLY target pre-auth screens
//   3. no auth required → light context note, nothing more
// Returns a string that always starts with a leading newline + ends with a
// trailing blank line so it can be slotted directly into the prompt template.
function formatLaunchStateSection(
  ls?: MaestroPromptLaunchState,
  creds?: MaestroPromptCreds,
  flowScreenNames?: string[],
): string {
  if (!ls) return '\n';

  const credsAvailable = Boolean(creds && (creds.email || creds.phone || creds.username));
  const flowTouchesPostAuth = flowScreenNames
    ? flowScreenNames.some((n) => !ls.authScreens.includes(n))
    : true;

  const header = `
## App Launch State
- Initial screen on cold launch: ${ls.initialScreen}
- Authentication required to reach app content: ${ls.requiresAuth ? 'YES' : 'NO'}
- Pre-auth screens (reachable without login): ${ls.authScreens.length > 0 ? ls.authScreens.join(', ') : '(none)'}${ls.postAuthEntry ? `\n- First screen after successful login: ${ls.postAuthEntry}` : ''}
`;

  if (!ls.requiresAuth) {
    return `${header}\n`;
  }

  if (credsAvailable && flowTouchesPostAuth) {
    const loginIdentifier = creds!.email ?? creds!.phone ?? creds!.username ?? 'test@example.com';
    const idField = creds!.email ? 'Email' : creds!.phone ? 'Phone' : 'Username';
    const passwordValue = creds!.password ?? 'TestPass123!';
    return `${header}
## CRITICAL: Authentication prefix is mandatory
This app requires authentication before any non-auth screen is reachable. EVERY flow you generate that targets a post-auth screen MUST begin with the following prefix, in this exact order, BEFORE any flow-specific steps:

\`\`\`
- launchApp
- extendedWaitUntil:
    visible: "${idField}"
    timeout: 15000
- tapOn: "${idField}"
- inputText: "${loginIdentifier}"
- tapOn: "Password"
- inputText: "${passwordValue}"
- tapOn: "Sign In"
- extendedWaitUntil:
    visible: "${ls.postAuthEntry ?? 'Home'}"
    timeout: 15000
\`\`\`

Adapt the visible labels above to match the actual login screen elements (use the screen vocabulary you were given). The intent is fixed: launch → wait for auth screen → fill credentials → submit → wait for post-auth landing → then proceed with your scenario steps.

Do NOT skip the prefix even if the flow's "Screens involved" list does not explicitly mention the login screen — the user always has to authenticate first.

`;
  }

  if (ls.requiresAuth && !credsAvailable) {
    return `${header}
## CRITICAL: No test credentials available
The target repo does not provide a \`bot-test-config.json\` with auth credentials, so post-authentication screens are NOT reachable in this run.

Generate flows ONLY for the pre-auth screens listed above (${ls.authScreens.join(', ') || 'none'}). Do NOT attempt to log in successfully or assert on post-auth content.

Useful flow ideas you CAN generate:
- App cold-launch smoke test (launchApp → assertVisible on the initial auth screen).
- Login form validation (empty submit, invalid email format → assert error message).
- Navigation between pre-auth screens (e.g. Login → Forgot Password → Login).
- Sign-up form rendering and field-level validation.

If the requested flow targets a post-auth screen, return an empty array \`[]\` — it is better to generate nothing than to generate a flow that cannot pass without credentials.

`;
  }

  return `${header}\n`;
}

// Renders the "Highly ambiguous labels" section for both prompts. Returns an empty
// string if there are none (so the prompt stays clean). Always emits leading +
// trailing newlines so the section slots cleanly into the surrounding template.
function formatDuplicateLabelsSection(dups?: { label: string; count: number }[]): string {
  if (!dups || dups.length === 0) return '\n';
  const list = dups
    .slice(0, 30)
    .map((d) => `  • "${d.label}" (${d.count} occurrences)`)
    .join('\n');
  return `
## Highly ambiguous labels — DO NOT use as a plain \`tapOn\` string
These labels appear on multiple elements across the app. A text-based tap on
any of them will be unstable. Use \`tapOn: { id: "<accessibilityId>" }\` from
the screen's element list, or anchor with \`extendedWaitUntil\` on a unique
screen heading first.
${list}

`;
}
