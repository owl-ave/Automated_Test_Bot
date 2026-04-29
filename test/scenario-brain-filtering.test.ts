import { hasUsableCreds, filterFlowsByLaunchState, capFlowsByPriority } from '../src/modules/scenario-brain';
import { AuthConfig, Flow, LaunchState } from '../src/types';

function flow(name: string, screens: string[], priority: Flow['priority'] = 'high', affectedByPr = false): Flow {
  return { name, screens, priority, affectedByPr };
}

const launchStateRequiresAuth: LaunchState = {
  initialScreen: 'LoginView',
  requiresAuth: true,
  authScreens: ['LoginView', 'SignupView', 'ForgotPasswordView'],
  postAuthEntry: 'HomeView',
  authMechanism: 'email_password',
  source: 'ai',
};

const launchStateNoAuth: LaunchState = {
  initialScreen: 'HomeView',
  requiresAuth: false,
  authScreens: [],
  authMechanism: 'unknown',
  source: 'heuristic',
};

describe('hasUsableCreds', () => {
  it('returns false when authConfig is undefined', () => {
    expect(hasUsableCreds(undefined)).toBe(false);
  });

  it("returns false for type='none'", () => {
    expect(hasUsableCreds({ type: 'none' })).toBe(false);
  });

  it("returns false for type='guest' even if email is set", () => {
    expect(hasUsableCreds({ type: 'guest', email: 'g@x.com' })).toBe(false);
  });

  it('returns true when email is present', () => {
    expect(hasUsableCreds({ type: 'email_password', email: 'a@b.com', password: 'x' })).toBe(true);
  });

  it('returns true when phone is present', () => {
    expect(hasUsableCreds({ type: 'phone_otp', phone: '+15555550100' })).toBe(true);
  });

  it('returns true when username is present', () => {
    expect(hasUsableCreds({ type: 'username_password', username: 'qa', password: 'x' })).toBe(true);
  });

  it("returns false when type is set but no identifier is present", () => {
    expect(hasUsableCreds({ type: 'email_password' } as AuthConfig)).toBe(false);
  });
});

describe('filterFlowsByLaunchState', () => {
  const flows: Flow[] = [
    flow('Sign In', ['LoginView']),
    flow('Sign Up', ['SignupView', 'LoginView']),
    flow('Edit Profile', ['HomeView', 'ProfileView']),
    flow('Activity', ['HomeView', 'ActivityView']),
    flow('Forgot Password', ['LoginView', 'ForgotPasswordView']),
  ];

  it('returns all flows unchanged when launchState is undefined', () => {
    expect(filterFlowsByLaunchState(flows, undefined, false)).toEqual(flows);
  });

  it('returns all flows unchanged when launchState says no auth required', () => {
    expect(filterFlowsByLaunchState(flows, launchStateNoAuth, false)).toEqual(flows);
  });

  it('returns all flows unchanged when creds are available (auth prefix will handle it)', () => {
    expect(filterFlowsByLaunchState(flows, launchStateRequiresAuth, true)).toEqual(flows);
  });

  it('drops post-auth flows when auth is required and no creds available', () => {
    const result = filterFlowsByLaunchState(flows, launchStateRequiresAuth, false);
    expect(result.map((f) => f.name)).toEqual(['Sign In', 'Sign Up', 'Forgot Password']);
  });

  it('returns all flows unchanged if authScreens list is empty (cannot reason about which are pre-auth)', () => {
    const ls: LaunchState = { ...launchStateRequiresAuth, authScreens: [] };
    expect(filterFlowsByLaunchState(flows, ls, false)).toEqual(flows);
  });

  it('drops flows with empty screens list when filtering is active', () => {
    const withEmpty = [...flows, flow('Mystery', [])];
    const result = filterFlowsByLaunchState(withEmpty, launchStateRequiresAuth, false);
    expect(result.map((f) => f.name)).not.toContain('Mystery');
  });
});

describe('capFlowsByPriority', () => {
  it('returns input unchanged when below cap', () => {
    const input = [flow('a', ['A']), flow('b', ['B'])];
    expect(capFlowsByPriority(input, 5)).toEqual(input);
  });

  it('keeps critical flows ahead of high/medium/low at the cap', () => {
    const input = [
      flow('low-1', ['L1'], 'low'),
      flow('high-1', ['H1'], 'high'),
      flow('critical-1', ['C1'], 'critical'),
      flow('medium-1', ['M1'], 'medium'),
      flow('critical-2', ['C2'], 'critical'),
    ];
    const out = capFlowsByPriority(input, 3);
    expect(out).toHaveLength(3);
    expect(out.map((f) => f.name).sort()).toEqual(['critical-1', 'critical-2', 'high-1']);
  });

  it('breaks ties at the same priority by preferring affectedByPr=true', () => {
    const input = [
      flow('high-untouched', ['A'], 'high', false),
      flow('high-touched', ['B'], 'high', true),
      flow('high-also-untouched', ['C'], 'high', false),
    ];
    const out = capFlowsByPriority(input, 1);
    expect(out).toEqual([input[1]]);
  });

  it('caps at 1 if requested', () => {
    const input = [flow('a', ['A'], 'high'), flow('b', ['B'], 'critical')];
    expect(capFlowsByPriority(input, 1)).toEqual([input[1]]);
  });

  it('handles empty input', () => {
    expect(capFlowsByPriority([], 8)).toEqual([]);
  });
});
