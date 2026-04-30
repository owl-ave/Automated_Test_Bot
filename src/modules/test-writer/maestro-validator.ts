import * as yaml from 'js-yaml';
import { CodeAnalysis, Element, MaestroFlow, MaestroValidationIssue } from '../../types';

// Structural checks for common AI-agent mistakes when generating Maestro flows.
// Errors block submission to BrowserStack (would burn quota for nothing);
// warnings ride along on the flow object and surface in the PR comment.
//
// Label validity (does "Home" actually exist in the app?) is intentionally NOT
// checked here — the regex-based source scan is incomplete by nature, so any
// offline vocabulary check produces false positives whenever the scanner misses
// a pattern (localized strings, constants, new SwiftUI APIs, etc.). Maestro
// itself is the source of truth for label resolution: a hallucinated label
// fails at `assertVisible` runtime, which is the correct place to find out.

const SUPPORTED_COMMANDS = new Set([
  'launchApp',
  'tapOn',
  'inputText',
  'assertVisible',
  'assertNotVisible',
  'extendedWaitUntil',
  'swipe',
  'scroll',
  'scrollUntilVisible',
  'back',
  'takeScreenshot',
  'pressKey',
  'hideKeyboard',
  'eraseText',
  'waitForAnimationToEnd',
]);

// Maestro commands that REQUIRE a non-empty payload — emitting them as a bare
// YAML scalar makes Maestro's parser reject the entire suite (run #70 lost all
// 28 flows because one flow had `- takeScreenshot` with no path).
//
// Bare commands NOT in this list (`scroll`, `back`, `hideKeyboard`,
// `launchApp`, `waitForAnimationToEnd`, `eraseText`) are valid in Maestro 1.39
// without arguments. eraseText specifically: bare clears the focused field's
// text; numeric arg erases that many characters. Both forms are legal.
const COMMANDS_REQUIRING_PAYLOAD = new Set([
  'takeScreenshot',
  'tapOn',
  'inputText',
  'assertVisible',
  'assertNotVisible',
  'extendedWaitUntil',
  'swipe',
  'scrollUntilVisible',
  'pressKey',
]);

const MAX_REPEAT_TIMES = 20;

const TEST_DOMAINS = [/example\.com$/i, /test\.com$/i, /test\.dev$/i, /localhost$/i, /\.test$/i];
const REAL_PHONE_RE = /\b(?:\+?\d{1,3}[-.\s]?)?(?!555[-.\s]?01\d{2})\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const CREDIT_CARD_RE = /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/;

export interface ValidatorContext {
  codeAnalysis: CodeAnalysis;
  expectedAppIds: { android?: string; ios?: string };
}

export function validateMaestroFlow(flow: MaestroFlow, ctx: ValidatorContext): MaestroValidationIssue[] {
  const issues: MaestroValidationIssue[] = [];

  let parsed: unknown;
  try {
    parsed = yaml.loadAll(flow.yaml);
  } catch (err) {
    issues.push({ severity: 'error', check: 'yaml-schema', message: `YAML parse failed: ${(err as Error).message}` });
    return issues;
  }

  const docs = Array.isArray(parsed) ? parsed : [];
  const config = (docs[0] as Record<string, unknown>) || {};
  const commands = (docs[1] as unknown[]) || [];

  // 3. Wrong / missing appId
  const appId = config.appId;
  if (typeof appId !== 'string' || !appId) {
    issues.push({ severity: 'error', check: 'app-id', message: 'Flow is missing `appId` in its config block' });
  } else if (
    ctx.expectedAppIds.android &&
    ctx.expectedAppIds.ios &&
    appId !== ctx.expectedAppIds.android &&
    appId !== ctx.expectedAppIds.ios
  ) {
    issues.push({
      severity: 'error',
      check: 'app-id',
      message: `Flow appId "${appId}" does not match build appIds (android=${ctx.expectedAppIds.android}, ios=${ctx.expectedAppIds.ios})`,
    });
  }

  // 10. YAML schema violation already handled above; further checks need an array.
  if (!Array.isArray(commands)) {
    issues.push({ severity: 'error', check: 'yaml-schema', message: 'Flow body must be a YAML sequence (list of commands)' });
    return issues;
  }

  // 2. Missing launchApp at flow start
  const first = commands[0];
  const isLaunch = first === 'launchApp' || (typeof first === 'object' && first !== null && 'launchApp' in (first as object));
  if (!isLaunch) {
    issues.push({ severity: 'error', check: 'launch-app', message: 'First command must be `launchApp`' });
  }

  // 12. Empty flow (after launchApp)
  if (commands.length < 3) {
    issues.push({
      severity: 'error',
      check: 'empty-flow',
      message: `Flow has only ${commands.length} command(s); needs at least 3 (launchApp + 1 action + 1 assertion)`,
    });
  }

  // Walk commands to gather more checks
  let assertionCount = 0;
  const tapTargets: { value: string; kind: 'id' | 'text' }[] = [];
  for (const cmd of commands) {
    const { name, payload } = decodeCommand(cmd);
    if (!name) continue;

    // 11. Unsupported command
    if (!SUPPORTED_COMMANDS.has(name)) {
      issues.push({
        severity: 'error',
        check: 'unsupported-command',
        message: `Unsupported Maestro command "${name}" — likely a hallucinated keyword`,
      });
      continue;
    }

    // 11b. Bare command that needs a payload — Maestro rejects the whole
    // suite if even one flow has e.g. `- takeScreenshot` without a path.
    if (COMMANDS_REQUIRING_PAYLOAD.has(name) && (payload === undefined || payload === null || payload === '')) {
      issues.push({
        severity: 'error',
        check: 'bare-command-needs-payload',
        message: `Command "${name}" requires a payload (e.g. \`${name}: "<value>"\`); a bare keyword fails Maestro's YAML parser and aborts every flow in the suite`,
      });
      continue;
    }

    if (name === 'assertVisible' || name === 'assertNotVisible') assertionCount++;

    // 5. Unbounded repeat
    if (name === 'repeat') {
      const times = (payload as { times?: unknown })?.times;
      if (typeof times !== 'number' || times <= 0 || times > MAX_REPEAT_TIMES) {
        issues.push({
          severity: 'error',
          check: 'repeat-bounds',
          message: `repeat.times must be a positive integer ≤ ${MAX_REPEAT_TIMES} (got ${String(times)})`,
        });
      }
    }

    // 6. Hardcoded PII / credentials in inputText
    if (name === 'inputText' && typeof payload === 'string') {
      const t = payload;
      const emailMatch = t.match(/[\w.+-]+@([\w-]+\.[\w.-]+)/);
      if (emailMatch && !TEST_DOMAINS.some((re) => re.test(emailMatch[1]))) {
        issues.push({
          severity: 'error',
          check: 'pii-email',
          message: `inputText contains non-test email "${emailMatch[0]}" — use @example.com / @test.com domains`,
        });
      }
      if (REAL_PHONE_RE.test(t) && !/(?:0{4}|1{4}|5{4})/.test(t)) {
        issues.push({
          severity: 'warn',
          check: 'pii-phone',
          message: 'inputText looks like a real phone number — prefer 555-01XX test ranges',
        });
      }
      if (CREDIT_CARD_RE.test(t)) {
        issues.push({
          severity: 'error',
          check: 'pii-card',
          message: 'inputText contains a credit-card-shaped value — never bake real PANs into tests',
        });
      }
    }

    // Track tap targets for ambiguity check (#7)
    if (name === 'tapOn') {
      const tap = extractTapTarget(payload);
      if (tap) tapTargets.push(tap);
    }
  }

  // 4. No assertions at all
  if (assertionCount === 0) {
    issues.push({
      severity: 'error',
      check: 'missing-assertion',
      message: 'Flow has no assertVisible/assertNotVisible — cannot verify outcome, false-pass risk',
    });
  }

  // 7. Ambiguous selector — same label appears on multiple elements in the offline vocab.
  //   - id-based taps (`tapOn: { id: "x" }`) are skipped: the AI is targeting a
  //     specific accessibility identifier, which is unambiguous by construction.
  //   - text-based taps that match more than one source element: surface as a
  //     warning so the dropped-flow report flags it, but never block submission.
  //     Static source counts overestimate the runtime ambiguity (SwiftUI/RN
  //     reuse the same string across screens but only one is visible at a time);
  //     blocking on the static count was rejecting flows that Maestro could
  //     actually execute correctly. If Maestro picks the wrong element at
  //     runtime, the test fails and the failure surfaces in the PR comment —
  //     which is a far better signal than zero flows ever running.
  const vocab = collectVocab(ctx.codeAnalysis);
  const textTaps = tapTargets.filter((t) => t.kind === 'text').map((t) => t.value);
  const labelCounts = countOccurrences(vocab, textTaps);
  for (const [label, count] of labelCounts) {
    if (count >= 2) {
      issues.push({
        severity: 'warn',
        check: 'ambiguous-selector',
        message: `Label "${label}" matches ${count} elements in source — Maestro may pick the wrong one. Prefer \`tapOn: { id: "<accessibilityId>" }\` or anchor with \`extendedWaitUntil\` on a unique screen heading first.`,
      });
    }
  }

  return issues;
}

// Run-level checks that look across all flows in a build (not per-flow). Use
// these to catch "the bot wrote 5 happy-path scenarios and zero negative tests"
// kind of mistakes.
export function validateRun(flows: MaestroFlow[]): MaestroValidationIssue[] {
  const issues: MaestroValidationIssue[] = [];

  // 9. No negative-path scenario across the whole run
  const hasNegative = flows.some((f) => /invalid|wrong|error|fail|denied|missing|empty/i.test(f.scenario));
  if (flows.length > 0 && !hasNegative) {
    issues.push({
      severity: 'warn',
      check: 'no-negative-path',
      message: 'No negative-path scenario detected across all flows — bot is only testing happy paths',
    });
  }

  return issues;
}

function decodeCommand(cmd: unknown): { name: string | null; payload: unknown } {
  if (typeof cmd === 'string') return { name: cmd, payload: undefined };
  if (cmd && typeof cmd === 'object') {
    const keys = Object.keys(cmd);
    if (keys.length === 1) return { name: keys[0], payload: (cmd as Record<string, unknown>)[keys[0]] };
  }
  return { name: null, payload: undefined };
}

// Distinguishes `tapOn: { id: "..." }` from `tapOn: "..."` / `tapOn: { text: "..." }`.
// Ambiguity only applies to text-label taps; id-based taps target a specific
// accessibility id and are unambiguous by construction.
function extractTapTarget(payload: unknown): { value: string; kind: 'id' | 'text' } | null {
  if (typeof payload === 'string') return { value: payload, kind: 'text' };
  if (payload && typeof payload === 'object') {
    const p = payload as { text?: unknown; id?: unknown };
    if (typeof p.id === 'string' && p.id) return { value: p.id, kind: 'id' };
    if (typeof p.text === 'string' && p.text) return { value: p.text, kind: 'text' };
  }
  return null;
}

function collectVocab(analysis: CodeAnalysis): Element[] {
  return analysis.screens.flatMap((s) => s.elements);
}

function countOccurrences(vocab: Element[], labels: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const label of labels) {
    let count = 0;
    for (const el of vocab) {
      const cand = [el.text, el.accessibilityId, el.resourceId, el.id].filter((s): s is string => Boolean(s));
      if (cand.some((c) => c.toLowerCase() === label.toLowerCase())) count++;
    }
    if (count > 0) out.set(label, (out.get(label) || 0) + count);
  }
  return out;
}
