import { LaunchStateDetector } from '../src/modules/app-analyzer/launch-state';
import { Screen } from '../src/types';

function screen(name: string): Screen {
  return { name, path: `${name}.swift`, type: 'swiftui-view', elements: [] };
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
});
