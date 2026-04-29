import { getMaestroFlowPrompt, getMaestroDiffPrompt } from '../src/ai/prompts/feature-generation';
import { MaestroAuthor } from '../src/modules/scenario-brain/feature-generator';

describe('Maestro flow generation prompt', () => {
  it('lists supported Maestro commands and never mentions Gherkin keywords', () => {
    const prompt = getMaestroFlowPrompt({
      industry: 'fintech',
      flowName: 'Login',
      screenNames: ['Login'],
      framework: 'react-native',
      screens: [
        {
          name: 'Login',
          elements: [
            { id: 'sign-in', type: 'button', text: 'Sign In' },
            { id: 'email', type: 'textfield', text: 'Email' },
          ],
        },
      ],
      appId: 'com.example.app',
    });
    expect(prompt).toContain('launchApp');
    expect(prompt).toContain('tapOn');
    expect(prompt).toContain('assertVisible');
    expect(prompt).toContain('com.example.app');
    expect(prompt).toContain('Sign In');
    // We migrated off Gherkin — the prompt MUST NOT reference the old DSL.
    expect(prompt).not.toMatch(/\bGiven\b/);
    expect(prompt).not.toMatch(/\bWhen user taps on\b/);
  });

  it('diff-mode prompt includes the visible vocab from the codebase', () => {
    const prompt = getMaestroDiffPrompt({
      industry: 'social',
      framework: 'kotlin',
      diffSummary: 'modified ProfileScreen.kt\n+ added avatar upload',
      appId: 'com.example.social',
      vocab: [{ id: 'avatar', type: 'button', text: 'Upload avatar' }],
    });
    expect(prompt).toContain('Upload avatar');
    expect(prompt).toContain('avatar upload');
    expect(prompt).toContain('com.example.social');
  });
});

describe('MaestroAuthor.parseFlowsJson', () => {
  const author = new MaestroAuthor();

  it('hydrates a valid JSON array of flows into MaestroFlow objects', () => {
    const response = JSON.stringify([
      {
        feature: 'Auth',
        scenario: 'User signs in',
        yaml: '- launchApp\n- tapOn: "Email"\n- inputText: "user@example.com"\n- tapOn: "Sign in"\n- assertVisible: "Welcome"',
      },
    ]);
    const flows = author.parseFlowsJson(response, 'PR Changes', 'com.example.app');
    expect(flows).toHaveLength(1);
    expect(flows[0].scenario).toBe('User signs in');
    expect(flows[0].fileName).toBe('user-signs-in.yaml');
    expect(flows[0].yaml).toContain('appId: "com.example.app"');
    expect(flows[0].yaml).toContain('---');
    expect(flows[0].yaml).toContain('- launchApp');
  });

  it('strips markdown code fences and trailing prose around the JSON array', () => {
    const response =
      'Here you go:\n```json\n' +
      JSON.stringify([{ feature: 'Auth', scenario: 'sign in', yaml: '- launchApp\n- assertVisible: "Hi"' }]) +
      '\n```\nDone.';
    const flows = author.parseFlowsJson(response, 'fallback', 'com.example.app');
    expect(flows).toHaveLength(1);
    expect(flows[0].yaml.startsWith('appId: ')).toBe(true);
  });

  it('drops malformed items but keeps valid ones', () => {
    const response = JSON.stringify([
      { feature: 'A', scenario: 'good', yaml: '- launchApp\n- assertVisible: "x"' },
      { scenario: 'no yaml' },
      'not an object',
    ]);
    const flows = author.parseFlowsJson(response, 'fallback', 'com.example.app');
    expect(flows).toHaveLength(1);
    expect(flows[0].scenario).toBe('good');
  });

  it('returns [] when the response has no JSON array', () => {
    const flows = author.parseFlowsJson('I cannot help with that.', 'fallback', 'com.example.app');
    expect(flows).toEqual([]);
  });
});
