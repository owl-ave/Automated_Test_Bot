import { LaunchStateDetector, parseAndValidateGates } from '../src/modules/app-analyzer/launch-state';
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
});
