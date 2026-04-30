import * as fs from 'fs';
import * as path from 'path';
import { LaunchState, PreAuthGate, PreAuthGateDismiss, Screen } from '../../types';
import { ClaudeClient } from '../../ai/claude-client';
import { safeJsonParse } from '../../ai/parse-json';
import { BUILD_VENDOR_SKIP_DIRS } from '../code-reader/skip-dirs';
import { Logger } from '../../utils/logger';

const logger = new Logger('LaunchStateDetector');

// Files we read to understand cold-launch routing. We pick the first 1-2 that
// exist — most apps have a clear single entry point and we don't want to dump
// the whole codebase into the prompt. iOS patterns use `**` so deeper layouts
// (e.g. `ios/app/App/NolaApp.swift`, `ios/Source/AppRouter.swift`) get picked
// up — the previous `ios/*/App.swift` and `ios/*/*App.swift` only matched 2-3
// segments and silently missed the routing file in Nola PR#8 (run from
// 2026-04-29). Without an entry-point file the AI gets only a bare screen
// list and routinely fails to detect language/onboarding gates.
const ENTRY_POINT_HINTS = [
  // iOS / Swift
  'ios/**/AppDelegate.swift',
  'ios/**/SceneDelegate.swift',
  'ios/**/AppRouter.swift',
  'ios/**/Router.swift',
  'ios/**/App.swift',
  'ios/**/*App.swift',
  '*App.swift',
  // Android / Kotlin
  'android/app/src/main/java/**/MainActivity.kt',
  'android/app/src/main/kotlin/**/MainActivity.kt',
  // React Native / Expo
  'App.tsx',
  'App.js',
  'src/App.tsx',
  'src/App.js',
  'index.js',
  'index.tsx',
  // Flutter
  'lib/main.dart',
];

const AUTH_SCREEN_NAME_RX = /login|signin|sign[_-]?in|signup|sign[_-]?up|register|onboard|welcome|splash|forgot|reset|otp|verify|auth/i;

// Reuse the shared deny-list so entry-point glob and screen scanner stay in
// lock-step — see src/modules/code-reader/skip-dirs.ts for the rationale.
const ENTRY_POINT_GLOB_SKIP_DIRS = BUILD_VENDOR_SKIP_DIRS;

export class LaunchStateDetector {
  private claudeClient: ClaudeClient;

  constructor(claudeClient?: ClaudeClient) {
    this.claudeClient = claudeClient ?? new ClaudeClient();
  }

  async detect(screens: Screen[], framework: string, mobilePath?: string): Promise<LaunchState> {
    if (screens.length === 0) {
      logger.warn('No screens to analyse — returning empty launch state');
      return this.heuristicFallback([]);
    }

    const entryPoints = this.collectEntryPoints(mobilePath, framework);
    try {
      const aiResult = await this.detectWithAi(screens, framework, entryPoints);
      if (aiResult) {
        logger.log('Launch state detected via AI', {
          initialScreen: aiResult.initialScreen,
          requiresAuth: aiResult.requiresAuth,
          authScreenCount: aiResult.authScreens.length,
          preAuthGates: aiResult.preAuthGates.map((g) => g.screen),
        });
        return aiResult;
      }
    } catch (err) {
      logger.warn('AI launch-state detection failed — using heuristic', err);
    }
    return this.heuristicFallback(screens);
  }

  // Reads a small set of likely entry-point files. We cap each file at 8KB so a
  // monorepo with a giant generated AppDelegate doesn't blow the prompt budget.
  private collectEntryPoints(mobilePath: string | undefined, framework: string): { path: string; content: string }[] {
    if (!mobilePath || !fs.existsSync(mobilePath)) return [];
    const projectRoot = path.dirname(mobilePath);
    const collected: { path: string; content: string }[] = [];
    const seen = new Set<string>();

    for (const pattern of ENTRY_POINT_HINTS) {
      const candidates = this.expandGlob(projectRoot, pattern);
      for (const candidate of candidates) {
        if (seen.has(candidate) || collected.length >= 3) continue;
        seen.add(candidate);
        try {
          const content = fs.readFileSync(candidate, 'utf-8').slice(0, 8192);
          collected.push({ path: path.relative(projectRoot, candidate), content });
        } catch {
          // Unreadable / disappeared between glob and read — skip silently.
        }
      }
      if (collected.length >= 3) break;
    }

    if (collected.length === 0) {
      logger.log('No entry-point files matched — AI will rely on screen list only', { framework });
    } else {
      logger.log('Entry-point files collected for launch-state detection', {
        files: collected.map((c) => c.path),
      });
    }
    return collected;
  }

  // Tiny glob: supports `*` (single segment) and `**` (any depth). We only
  // need this for the curated ENTRY_POINT_HINTS list — not a general-purpose
  // matcher.
  private expandGlob(root: string, pattern: string): string[] {
    const segments = pattern.split('/');
    return this.walkSegments(root, segments);
  }

  private walkSegments(currentDir: string, segments: string[]): string[] {
    if (segments.length === 0) return fs.existsSync(currentDir) ? [currentDir] : [];
    if (!fs.existsSync(currentDir)) return [];
    let stat: fs.Stats;
    try {
      stat = fs.statSync(currentDir);
    } catch {
      return [];
    }
    if (!stat.isDirectory()) return [];

    const [head, ...rest] = segments;
    const results: string[] = [];

    if (head === '**') {
      // Match zero or more directory levels — recurse with the same `rest`.
      results.push(...this.walkSegments(currentDir, rest));
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return results;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && !ENTRY_POINT_GLOB_SKIP_DIRS.has(entry.name)) {
          results.push(...this.walkSegments(path.join(currentDir, entry.name), segments));
        }
      }
      return results;
    }

    if (head.includes('*')) {
      const rx = new RegExp('^' + head.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return results;
      }
      for (const entry of entries) {
        if (rx.test(entry.name)) {
          const next = path.join(currentDir, entry.name);
          if (rest.length === 0) results.push(next);
          else results.push(...this.walkSegments(next, rest));
        }
      }
      return results;
    }

    const next = path.join(currentDir, head);
    if (rest.length === 0) {
      return fs.existsSync(next) ? [next] : [];
    }
    return this.walkSegments(next, rest);
  }

  private async detectWithAi(
    screens: Screen[],
    framework: string,
    entryPoints: { path: string; content: string }[],
  ): Promise<LaunchState | null> {
    const screenList = screens
      .slice(0, 60)
      .map((s) => `- ${s.name} [${s.type}]`)
      .join('\n');
    const entryPointSection = entryPoints.length === 0
      ? '(no entry-point files found — infer from screen names)'
      : entryPoints
          .map((ep) => `### ${ep.path}\n\`\`\`\n${ep.content}\n\`\`\``)
          .join('\n\n');

    const prompt = `You are a mobile app analyst. Determine the cold-launch behaviour of a ${framework} app.

## Screens in the codebase
${screenList}

## Entry-point file(s)
${entryPointSection}

## Task
Identify:
1. Which screen the app shows on first cold launch (before any user interaction).
2. Whether the user MUST authenticate before reaching the main app content.
3. Which screens are reachable without authentication (login, signup, onboarding, splash, forgot password, etc.).
4. Which screen the user lands on after successful authentication, if applicable.
5. The authentication mechanism, if you can tell.
6. The ORDERED sequence of gate screens the user passes through between cold launch and the first screen where they can make a navigation choice. Include splash screens, language pickers, "Get Started" intros, tracking-permission prompts, etc. For each gate, identify how it is dismissed:
   - "auto" if it disappears on its own (animated splash, timed redirect)
   - "tap" with the visible label of the primary button (e.g. "Continue", "Get Started", "Allow")
   - "system-permission" if it is an OS dialog (notification permission, location, tracking) — set "allow" to true unless denying is required
   For "tap" gates, optionally include "waitForVisible" — a unique text on that gate screen used to confirm it is up before tapping.

Use ONLY screen names that appear in the list above for "initialScreen", "authScreens", "postAuthEntry", and each gate's "screen".

## Output
Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "initialScreen": "<screen name>",
  "requiresAuth": <true|false>,
  "authScreens": ["<screen name>", ...],
  "postAuthEntry": "<screen name or null>",
  "authMechanism": "<email_password|phone_otp|username_password|biometric|wallet|oauth|unknown>",
  "preAuthGates": [
    { "screen": "<screen name>", "dismiss": { "type": "auto" } },
    { "screen": "<screen name>", "dismiss": { "type": "tap", "label": "<button label>" }, "waitForVisible": "<anchor text>" },
    { "screen": "<screen name>", "dismiss": { "type": "system-permission", "allow": true } }
  ]
}`;

    const response = await this.claudeClient.analyzeCode('', prompt);
    const parsed = safeJsonParse<{
      initialScreen?: unknown;
      requiresAuth?: unknown;
      authScreens?: unknown;
      postAuthEntry?: unknown;
      authMechanism?: unknown;
      preAuthGates?: unknown;
    }>(response);

    if (!parsed || typeof parsed !== 'object') return null;

    const knownScreenNames = new Set(screens.map((s) => s.name));

    const initialScreen = typeof parsed.initialScreen === 'string' && knownScreenNames.has(parsed.initialScreen)
      ? parsed.initialScreen
      : screens[0].name;
    const requiresAuth = typeof parsed.requiresAuth === 'boolean' ? parsed.requiresAuth : false;
    const authScreens = Array.isArray(parsed.authScreens)
      ? parsed.authScreens.filter((s): s is string => typeof s === 'string' && knownScreenNames.has(s))
      : [];
    const postAuthEntry = typeof parsed.postAuthEntry === 'string' && knownScreenNames.has(parsed.postAuthEntry)
      ? parsed.postAuthEntry
      : undefined;
    const allowedMechanisms = ['email_password', 'phone_otp', 'username_password', 'biometric', 'wallet', 'oauth', 'unknown'] as const;
    const authMechanism = typeof parsed.authMechanism === 'string' && (allowedMechanisms as readonly string[]).includes(parsed.authMechanism)
      ? (parsed.authMechanism as LaunchState['authMechanism'])
      : 'unknown';

    const preAuthGates = parseAndValidateGates(parsed.preAuthGates, screens);

    return {
      initialScreen,
      requiresAuth,
      authScreens,
      postAuthEntry,
      authMechanism,
      preAuthGates,
      source: 'ai',
    };
  }

  // Pure name-pattern fallback. Used when AI is unavailable or returns nothing
  // parseable. Conservative: if any auth-looking screen exists, we assume auth
  // is required so generated flows include the prefix.
  heuristicFallback(screens: Screen[]): LaunchState {
    const authScreens = screens
      .filter((s) => AUTH_SCREEN_NAME_RX.test(s.name))
      .map((s) => s.name);
    const requiresAuth = authScreens.length > 0;
    const initialScreen = requiresAuth
      ? authScreens[0]
      : (screens[0]?.name ?? 'Unknown');
    const postAuthEntry = requiresAuth
      ? screens.find((s) => !AUTH_SCREEN_NAME_RX.test(s.name))?.name
      : undefined;

    return {
      initialScreen,
      requiresAuth,
      authScreens,
      postAuthEntry,
      authMechanism: 'unknown',
      preAuthGates: [],
      source: 'heuristic',
    };
  }
}

// Parses + validates the AI's `preAuthGates` array. Drops any gate whose
// screen isn't in the codebase, whose tap label isn't an actual element on
// that screen, or whose shape we can't reconcile to a known dismiss type.
// Anything sketchy is dropped silently — emitting a partial preamble is much
// safer than emitting one with invented labels Maestro can't find.
export function parseAndValidateGates(raw: unknown, screens: Screen[]): PreAuthGate[] {
  if (!Array.isArray(raw)) return [];

  const screenLookup = new Map(screens.map((s) => [s.name, s]));
  const out: PreAuthGate[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.screen !== 'string') continue;
    const screen = screenLookup.get(obj.screen);
    if (!screen) continue;

    const dismissRaw = obj.dismiss as Record<string, unknown> | undefined;
    if (!dismissRaw || typeof dismissRaw !== 'object') continue;

    let dismiss: PreAuthGateDismiss | null = null;
    if (dismissRaw.type === 'auto') {
      dismiss = { type: 'auto' };
    } else if (dismissRaw.type === 'tap' && typeof dismissRaw.label === 'string') {
      const labelMatchesElement = screen.elements.some(
        (e) => e.text === dismissRaw.label || e.accessibilityId === dismissRaw.label,
      );
      if (labelMatchesElement) {
        dismiss = { type: 'tap', label: dismissRaw.label };
      }
    } else if (dismissRaw.type === 'tap-id' && typeof dismissRaw.id === 'string') {
      // Only emit a real `tap-id` gate when the id matches an actual
      // `.accessibilityIdentifier(...)` from the source. extractSwiftElements
      // also stores text-derived synthetic ids (e.g. `Button("Continue")` →
      // `id: "continue"`) in the same `id` field — those don't exist on the
      // device. If the AI picked a synthetic id, demote the gate to a
      // text-based `tap` using the element's visible text so Maestro can
      // actually find it. This was the silent-failure mode in the iOS run
      // from 2026-04-29: preamble emitted `tapOn: { id: "continue" }`, no
      // such a11y id existed, the tap timed out, the flow never advanced.
      const realA11y = screen.elements.find((e) => e.accessibilityId === dismissRaw.id);
      if (realA11y) {
        dismiss = { type: 'tap-id', id: dismissRaw.id };
      } else {
        const synthetic = screen.elements.find((e) => e.id === dismissRaw.id && typeof e.text === 'string' && e.text);
        if (synthetic) {
          dismiss = { type: 'tap', label: synthetic.text! };
        }
      }
    } else if (dismissRaw.type === 'system-permission') {
      dismiss = { type: 'system-permission', allow: dismissRaw.allow !== false };
    }

    if (!dismiss) continue;

    const gate: PreAuthGate = { screen: screen.name, dismiss };
    if (typeof obj.waitForVisible === 'string' && obj.waitForVisible.trim()) {
      gate.waitForVisible = obj.waitForVisible;
    }
    out.push(gate);
  }

  return out;
}
