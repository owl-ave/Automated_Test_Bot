import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LaunchStateDetector, parseAndValidateGates } from '../src/modules/app-analyzer/launch-state';
import { ClaudeClient } from '../src/ai/claude-client';
import { Element, Screen } from '../src/types';

function screen(name: string, elements: Element[] = []): Screen {
  return { name, path: `${name}.swift`, type: 'swiftui-view', elements };
}

function el(text: string, accessibilityId?: string): Element {
  return { id: text, type: 'button', text, accessibilityId };
}

describe('LaunchStateDetector heuristic fallback', () => {
  const detector = new LaunchStateDetector();

  it('reports requiresAuth=false when no auth-looking screens exist', () => {
    const result = detector.heuristicFallback([screen('Home'), screen('Settings'), screen('Profile')]);
    expect(result.requiresAuth).toBe(false);
    expect(result.authScreens).toEqual([]);
    expect(result.initialScreen).toBe('Home');
    expect(result.source).toBe('heuristic');
  });

  it('detects login-like screens and marks auth required', () => {
    const result = detector.heuristicFallback([
      screen('LoginView'),
      screen('SignupView'),
      screen('HomeView'),
      screen('ProfileView'),
    ]);
    expect(result.requiresAuth).toBe(true);
    expect(result.authScreens).toEqual(['LoginView', 'SignupView']);
    expect(result.initialScreen).toBe('LoginView');
    expect(result.postAuthEntry).toBe('HomeView');
  });

  it('detects onboarding and splash as pre-auth screens', () => {
    const result = detector.heuristicFallback([
      screen('SplashScreen'),
      screen('OnboardingView'),
      screen('SignInView'),
      screen('Dashboard'),
    ]);
    expect(result.requiresAuth).toBe(true);
    expect(result.authScreens).toEqual(['SplashScreen', 'OnboardingView', 'SignInView']);
    expect(result.postAuthEntry).toBe('Dashboard');
  });

  it('handles empty screen list without crashing', () => {
    const result = detector.heuristicFallback([]);
    expect(result.initialScreen).toBe('Unknown');
    expect(result.requiresAuth).toBe(false);
    expect(result.authScreens).toEqual([]);
  });

  it('detect() returns a heuristic result when AI is unavailable (no token)', async () => {
    // No CLAUDE_CODE_OAUTH_TOKEN configured in test env → AI call will fail and
    // we should land on the heuristic.
    const result = await detector.detect(
      [screen('LoginView'), screen('Home')],
      'swift',
      undefined,
    );
    expect(result.source).toBe('heuristic');
    expect(result.requiresAuth).toBe(true);
  });

  it('heuristic populates preAuthGates as empty array', () => {
    const result = detector.heuristicFallback([screen('LoginView'), screen('Home')]);
    expect(result.preAuthGates).toEqual([]);
  });
});

describe('parseAndValidateGates', () => {
  const screens: Screen[] = [
    screen('SplashView'),
    screen('LanguageGateView', [el('Continue'), el('Choose your language')]),
    screen('OnboardingView', [el('Get Started')]),
    screen('PermissionView'),
  ];

  it('returns [] for non-array input', () => {
    expect(parseAndValidateGates(undefined, screens)).toEqual([]);
    expect(parseAndValidateGates({}, screens)).toEqual([]);
    expect(parseAndValidateGates('nope', screens)).toEqual([]);
  });

  it('keeps a valid auto-dismiss gate', () => {
    const result = parseAndValidateGates(
      [{ screen: 'SplashView', dismiss: { type: 'auto' } }],
      screens,
    );
    expect(result).toEqual([{ screen: 'SplashView', dismiss: { type: 'auto' } }]);
  });

  it('keeps a tap gate when label matches an element on the screen', () => {
    const result = parseAndValidateGates(
      [
        {
          screen: 'LanguageGateView',
          dismiss: { type: 'tap', label: 'Continue' },
          waitForVisible: 'Choose your language',
        },
      ],
      screens,
    );
    expect(result).toEqual([
      {
        screen: 'LanguageGateView',
        dismiss: { type: 'tap', label: 'Continue' },
        waitForVisible: 'Choose your language',
      },
    ]);
  });

  it('drops a tap gate whose label is not an element of that screen', () => {
    const result = parseAndValidateGates(
      [{ screen: 'LanguageGateView', dismiss: { type: 'tap', label: 'Skip' } }],
      screens,
    );
    expect(result).toEqual([]);
  });

  it('drops a gate whose screen is not in the codebase', () => {
    const result = parseAndValidateGates(
      [{ screen: 'GhostScreen', dismiss: { type: 'auto' } }],
      screens,
    );
    expect(result).toEqual([]);
  });

  it('preserves order across mixed valid/invalid gates', () => {
    const result = parseAndValidateGates(
      [
        { screen: 'SplashView', dismiss: { type: 'auto' } },
        { screen: 'GhostScreen', dismiss: { type: 'auto' } },
        { screen: 'LanguageGateView', dismiss: { type: 'tap', label: 'Continue' } },
        { screen: 'OnboardingView', dismiss: { type: 'tap', label: 'Get Started' } },
      ],
      screens,
    );
    expect(result.map((g) => g.screen)).toEqual([
      'SplashView',
      'LanguageGateView',
      'OnboardingView',
    ]);
  });

  it('accepts system-permission gates and defaults allow=true', () => {
    const result = parseAndValidateGates(
      [{ screen: 'PermissionView', dismiss: { type: 'system-permission' } }],
      screens,
    );
    expect(result).toEqual([
      { screen: 'PermissionView', dismiss: { type: 'system-permission', allow: true } },
    ]);
  });

  it('honours explicit allow=false on system-permission', () => {
    const result = parseAndValidateGates(
      [{ screen: 'PermissionView', dismiss: { type: 'system-permission', allow: false } }],
      screens,
    );
    expect(result[0].dismiss).toEqual({ type: 'system-permission', allow: false });
  });

  // Run from 2026-04-29 (build ios-pr-8-1777461958451) had 4/5 flows fail
  // because the cold-launch preamble emitted `tapOn: { id: "continue" }` for a
  // SwiftUI `Button("Continue")` with no `.accessibilityIdentifier(...)`. The
  // synthetic id never matched anything on device, the tap silently timed out,
  // and assertions downstream failed. These tests pin the demote-to-tap fix.
  describe('tap-id gates and synthetic ids', () => {
    const a11yScreens: Screen[] = [
      // 'continue_button' is a real .accessibilityIdentifier(...) value
      screen('GateA', [
        { id: 'continue_button', type: 'element', accessibilityId: 'continue_button' },
      ]),
      // 'continue' is a synthetic id derived from Button("Continue") — no real a11y id
      screen('GateB', [{ id: 'continue', type: 'button', text: 'Continue' }]),
      // No matching id at all
      screen('GateC', [{ id: 'other', type: 'button', text: 'Other' }]),
    ];

    it('keeps a tap-id gate when the id matches a real accessibilityId', () => {
      const result = parseAndValidateGates(
        [{ screen: 'GateA', dismiss: { type: 'tap-id', id: 'continue_button' } }],
        a11yScreens,
      );
      expect(result).toEqual([
        { screen: 'GateA', dismiss: { type: 'tap-id', id: 'continue_button' } },
      ]);
    });

    it('demotes a tap-id gate to a text-based tap when only a synthetic id matches', () => {
      const result = parseAndValidateGates(
        [{ screen: 'GateB', dismiss: { type: 'tap-id', id: 'continue' } }],
        a11yScreens,
      );
      expect(result).toEqual([
        { screen: 'GateB', dismiss: { type: 'tap', label: 'Continue' } },
      ]);
    });

    it('drops a tap-id gate when neither real a11y id nor synthetic id matches', () => {
      const result = parseAndValidateGates(
        [{ screen: 'GateC', dismiss: { type: 'tap-id', id: 'continue' } }],
        a11yScreens,
      );
      expect(result).toEqual([]);
    });
  });
});

// Run from 2026-04-29 (Nola PR#8) had no preauth gate emitted because
// ENTRY_POINT_HINTS only matched 2-3 segments deep — the repo's routing file
// at `ios/app/App/AppRouter.swift` was never read, so the AI got just a bare
// screen list and missed LanguageGateView's "Continue" gate. These tests pin
// the broadened-glob fix.
describe('LaunchStateDetector entry-point discovery', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-state-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  // Captures whatever prompt the detector sends to ClaudeClient.analyzeCode,
  // returns a stub JSON response so detect() can finish parsing.
  class CapturingClient extends ClaudeClient {
    public lastPrompt = '';
    constructor() {
      super();
    }
    override async analyzeCode(_code: string, instruction: string): Promise<string> {
      this.lastPrompt = instruction;
      return JSON.stringify({
        initialScreen: 'LanguageGateView',
        requiresAuth: true,
        authScreens: ['LanguageGateView'],
        postAuthEntry: null,
        authMechanism: 'unknown',
        preAuthGates: [],
      });
    }
  }

  it('reads AppRouter.swift and the *App.swift entry from a deep iOS layout (Nola PR#8 repro)', async () => {
    write('ios/Nola.xcodeproj/project.pbxproj', '');
    write('ios/app/App/AppRouter.swift', '// AppRouter.swift content — Gate enum lives here');
    write('ios/app/App/NolaApp.swift', '// NolaApp.swift content — @main struct');
    write('ios/app/Shared/LanguageGateView.swift', 'struct LanguageGateView: View {}');

    const client = new CapturingClient();
    const detector = new LaunchStateDetector(client);
    const screens: Screen[] = [{
      name: 'LanguageGateView',
      path: 'ios/app/Shared/LanguageGateView.swift',
      type: 'swiftui-view',
      elements: [],
    }];

    await detector.detect(screens, 'swift', path.join(tmp, 'ios'));

    expect(client.lastPrompt).toContain('AppRouter.swift');
    expect(client.lastPrompt).toContain('NolaApp.swift');
    expect(client.lastPrompt).toContain('Gate enum lives here');
  });

  it('skips vendor AppDelegates under build/DerivedData (Nola PR#8 regression repro)', async () => {
    // The 2026-04-29 re-run had `ios/**/AppDelegate.swift` matching three
    // sample apps inside SwiftPM checkouts (Firebase, GoogleDataTransport)
    // which filled the 3-file cap before the real routing file could be
    // collected. Result: AI saw vendor code, no preauth gate emitted.
    write('ios/Nola.xcodeproj/project.pbxproj', '');
    write('ios/build/DerivedData/SourcePackages/checkouts/firebase-ios-sdk/Example/tvOSSample/tvOSSample/AppDelegate.swift', '// vendor sample — must not be picked up');
    write('ios/build/DerivedData/SourcePackages/checkouts/firebase-ios-sdk/CoreOnly/Tests/FirebasePodTest/FirebasePodTest/AppDelegate.swift', '// vendor sample');
    write('ios/build/DerivedData/SourcePackages/checkouts/GoogleDataTransport/GoogleDataTransport/GDTCCTWatchOSTestApp/GDTCCTiOSTestAppForCompanionWatchApp/AppDelegate.swift', '// vendor sample');
    write('ios/Pods/SomePodWithItsOwnApp/AppDelegate.swift', '// pod sample');
    write('ios/app/App/AppRouter.swift', '// real routing file');
    write('ios/app/App/NolaApp.swift', '// @main struct');

    const client = new CapturingClient();
    const detector = new LaunchStateDetector(client);
    await detector.detect(
      [{ name: 'LanguageGateView', path: 'x.swift', type: 'swiftui-view', elements: [] }],
      'swift',
      path.join(tmp, 'ios'),
    );

    expect(client.lastPrompt).toContain('AppRouter.swift');
    expect(client.lastPrompt).toContain('NolaApp.swift');
    expect(client.lastPrompt).not.toContain('vendor sample');
    expect(client.lastPrompt).not.toContain('pod sample');
    expect(client.lastPrompt).not.toContain('build/DerivedData');
  });

  it('still picks up traditional flat layouts (AppDelegate.swift directly under ios/<project>)', async () => {
    write('ios/MyApp.xcodeproj/project.pbxproj', '');
    write('ios/MyApp/AppDelegate.swift', '// classic AppDelegate');

    const client = new CapturingClient();
    const detector = new LaunchStateDetector(client);
    await detector.detect(
      [{ name: 'Home', path: 'ios/MyApp/HomeView.swift', type: 'swiftui-view', elements: [] }],
      'swift',
      path.join(tmp, 'ios'),
    );

    expect(client.lastPrompt).toContain('AppDelegate.swift');
    expect(client.lastPrompt).toContain('classic AppDelegate');
  });
});
