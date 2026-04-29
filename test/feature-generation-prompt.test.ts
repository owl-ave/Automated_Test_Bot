import {
  getMaestroFlowPrompt,
  getMaestroDiffPrompt,
  MaestroPromptLaunchState,
  MaestroPromptCreds,
} from '../src/ai/prompts/feature-generation';

const baseArgs = {
  industry: 'Finance',
  flowName: 'Edit Profile',
  screenNames: ['HomeView', 'ProfileView', 'EditProfileView'],
  framework: 'swift',
  screens: [
    { name: 'HomeView', elements: [{ id: 'home', type: 'view' }] },
    { name: 'ProfileView', elements: [{ id: 'profile', type: 'view' }] },
    { name: 'EditProfileView', elements: [{ id: 'edit', type: 'view' }] },
  ],
  appId: 'money.nola.app',
};

const launchStateRequiresAuth: MaestroPromptLaunchState = {
  initialScreen: 'LoginView',
  requiresAuth: true,
  authScreens: ['LoginView', 'SignupView'],
  postAuthEntry: 'HomeView',
};

const launchStateNoAuth: MaestroPromptLaunchState = {
  initialScreen: 'HomeView',
  requiresAuth: false,
  authScreens: [],
};

const creds: MaestroPromptCreds = { email: 'qa@nola.test', password: 'TestPass123!' };

describe('getMaestroFlowPrompt — launch-state aware', () => {
  it('omits launch-state section when no launchState given (back-compat)', () => {
    const prompt = getMaestroFlowPrompt(baseArgs);
    expect(prompt).not.toContain('App Launch State');
    expect(prompt).not.toContain('Authentication prefix is mandatory');
  });

  it('includes one-happy-path instruction (not 1+2+1)', () => {
    const prompt = getMaestroFlowPrompt(baseArgs);
    expect(prompt).toContain('exactly ONE Happy Path scenario');
    expect(prompt).not.toMatch(/Two Edge Case scenarios/);
  });

  it('emits auth prefix instructions when requiresAuth + creds + post-auth flow', () => {
    const prompt = getMaestroFlowPrompt({
      ...baseArgs,
      launchState: launchStateRequiresAuth,
      creds,
    });
    expect(prompt).toContain('App Launch State');
    expect(prompt).toContain('Authentication prefix is mandatory');
    expect(prompt).toContain('qa@nola.test');
    expect(prompt).toContain('TestPass123!');
    expect(prompt).toContain('HomeView'); // postAuthEntry rendered into wait
  });

  it('emits no-creds instructions when requiresAuth and no creds', () => {
    const prompt = getMaestroFlowPrompt({
      ...baseArgs,
      launchState: launchStateRequiresAuth,
      creds: undefined,
    });
    expect(prompt).toContain('No test credentials available');
    expect(prompt).toContain('return an empty array');
    expect(prompt).not.toContain('Authentication prefix is mandatory');
  });

  it('skips auth prefix when flow only touches pre-auth screens', () => {
    const prompt = getMaestroFlowPrompt({
      ...baseArgs,
      flowName: 'Sign In',
      screenNames: ['LoginView'],
      launchState: launchStateRequiresAuth,
      creds,
    });
    expect(prompt).toContain('App Launch State');
    // Auth-screen-only flow shouldn't be told to add the auth prefix
    expect(prompt).not.toContain('Authentication prefix is mandatory');
  });

  it('emits a light launch-state note when no auth is required', () => {
    const prompt = getMaestroFlowPrompt({
      ...baseArgs,
      launchState: launchStateNoAuth,
    });
    expect(prompt).toContain('App Launch State');
    expect(prompt).toContain('Authentication required to reach app content: NO');
    expect(prompt).not.toContain('Authentication prefix is mandatory');
    expect(prompt).not.toContain('No test credentials available');
  });

  it('uses phone field when only phone is configured', () => {
    const prompt = getMaestroFlowPrompt({
      ...baseArgs,
      launchState: launchStateRequiresAuth,
      creds: { phone: '+15555550100', password: 'p' },
    });
    expect(prompt).toContain('+15555550100');
    expect(prompt).toContain('"Phone"'); // input-field heading
  });
});

describe('getMaestroDiffPrompt — launch-state aware', () => {
  const diffArgs = {
    industry: 'Finance',
    framework: 'swift',
    diffSummary: 'modified ios/Profile/EditProfileView.swift',
    appId: 'money.nola.app',
    vocab: [{ id: 'edit', type: 'button' }],
  };

  it('respects creds + launchState in the diff prompt path', () => {
    const prompt = getMaestroDiffPrompt({
      ...diffArgs,
      launchState: launchStateRequiresAuth,
      creds,
    });
    expect(prompt).toContain('Authentication prefix is mandatory');
    expect(prompt).toContain('qa@nola.test');
  });

  it('switches to no-creds mode when creds absent', () => {
    const prompt = getMaestroDiffPrompt({
      ...diffArgs,
      launchState: launchStateRequiresAuth,
    });
    expect(prompt).toContain('No test credentials available');
  });

  it('caps suggested flows to 3-5 short flows', () => {
    const prompt = getMaestroDiffPrompt(diffArgs);
    expect(prompt).toContain('3–5 short flows');
    expect(prompt).not.toContain('3–8 flows');
  });
});
