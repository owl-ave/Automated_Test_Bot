import { validateMaestroFlow, validateRun } from '../src/modules/test-writer/maestro-validator';
import { CodeAnalysis, MaestroFlow } from '../src/types';

const baseAnalysis: CodeAnalysis = {
  framework: 'react-native',
  industry: 'fintech',
  apiEndpoints: [],
  criticalFlows: [],
  screens: [
    {
      name: 'Login',
      path: 'src/screens/Login.tsx',
      type: 'screen',
      elements: [
        { id: 'sign-in', type: 'button', text: 'Sign In' },
        { id: 'email', type: 'textfield', text: 'Email' },
        { id: 'welcome', type: 'text', text: 'Welcome' },
      ],
    },
  ],
};

function makeFlow(yaml: string, overrides: Partial<MaestroFlow> = {}): MaestroFlow {
  return {
    feature: 'Auth',
    scenario: 'Sign in',
    appId: 'com.example.app',
    fileName: 'sign-in.yaml',
    yaml,
    issues: [],
    ...overrides,
  };
}

const ctx = {
  codeAnalysis: baseAnalysis,
  expectedAppIds: { android: 'com.example.app', ios: 'com.example.app' },
};

describe('validateMaestroFlow', () => {
  it('passes a clean flow with launchApp + tapOn + assertVisible', () => {
    const yaml = `appId: com.example.app
---
- launchApp
- tapOn: Sign In
- assertVisible: Welcome
`;
    const issues = validateMaestroFlow(makeFlow(yaml), ctx);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('errors when launchApp is missing', () => {
    const yaml = `appId: com.example.app
---
- tapOn: Sign In
- assertVisible: Welcome
`;
    const issues = validateMaestroFlow(makeFlow(yaml), ctx);
    expect(issues.some((i) => i.check === 'launch-app')).toBe(true);
  });

  it('errors when appId is missing', () => {
    const yaml = `foo: bar
---
- launchApp
- tapOn: Sign In
- assertVisible: Welcome
`;
    const issues = validateMaestroFlow(makeFlow(yaml), ctx);
    expect(issues.some((i) => i.check === 'app-id')).toBe(true);
  });

  it('errors when no assertions exist', () => {
    const yaml = `appId: com.example.app
---
- launchApp
- tapOn: Sign In
- tapOn: Email
`;
    const issues = validateMaestroFlow(makeFlow(yaml), ctx);
    expect(issues.some((i) => i.check === 'missing-assertion')).toBe(true);
  });

  it('errors on hallucinated label not in vocab', () => {
    const yaml = `appId: com.example.app
---
- launchApp
- tapOn: Submit Order Now
- assertVisible: Welcome
`;
    const issues = validateMaestroFlow(makeFlow(yaml), ctx);
    expect(issues.some((i) => i.check === 'hallucinated-label')).toBe(true);
  });

  it('errors on hardcoded production-looking email', () => {
    const yaml = `appId: com.example.app
---
- launchApp
- tapOn: Email
- inputText: john.smith@gmail.com
- assertVisible: Welcome
`;
    const issues = validateMaestroFlow(makeFlow(yaml), ctx);
    expect(issues.some((i) => i.check === 'pii-email')).toBe(true);
  });

  it('accepts test-domain emails', () => {
    const yaml = `appId: com.example.app
---
- launchApp
- tapOn: Email
- inputText: user@example.com
- assertVisible: Welcome
`;
    const issues = validateMaestroFlow(makeFlow(yaml), ctx);
    expect(issues.filter((i) => i.severity === 'error' && i.check === 'pii-email')).toEqual([]);
  });

  it('errors on credit card-shaped value', () => {
    const yaml = `appId: com.example.app
---
- launchApp
- tapOn: Email
- inputText: 4111-1111-1111-1111
- assertVisible: Welcome
`;
    const issues = validateMaestroFlow(makeFlow(yaml), ctx);
    expect(issues.some((i) => i.check === 'pii-card')).toBe(true);
  });

  it('errors on empty flow (only launchApp)', () => {
    const yaml = `appId: com.example.app
---
- launchApp
`;
    const issues = validateMaestroFlow(makeFlow(yaml), ctx);
    expect(issues.some((i) => i.check === 'empty-flow')).toBe(true);
  });

  it('demotes errors to warnings in lenient mode', () => {
    const yaml = `appId: com.example.app
---
- launchApp
- tapOn: Some Phantom Button
`;
    const issues = validateMaestroFlow(makeFlow(yaml), { ...ctx, lenient: true });
    expect(issues.every((i) => i.severity === 'warn')).toBe(true);
  });

  it('errors on YAML parse failure', () => {
    const issues = validateMaestroFlow(makeFlow('not: valid: : yaml: ['), ctx);
    expect(issues.some((i) => i.check === 'yaml-schema')).toBe(true);
  });
});

describe('validateRun', () => {
  it('warns when no negative-path scenario exists', () => {
    const flows: MaestroFlow[] = [
      makeFlow('', { scenario: 'User signs in successfully' }),
      makeFlow('', { scenario: 'User views dashboard' }),
    ];
    const issues = validateRun(flows);
    expect(issues.some((i) => i.check === 'no-negative-path')).toBe(true);
  });

  it('passes when at least one negative-path scenario exists', () => {
    const flows: MaestroFlow[] = [
      makeFlow('', { scenario: 'User signs in with invalid password' }),
      makeFlow('', { scenario: 'User views dashboard' }),
    ];
    const issues = validateRun(flows);
    expect(issues.some((i) => i.check === 'no-negative-path')).toBe(false);
  });
});
