// Mock for @anthropic-ai/claude-agent-sdk
export async function* query(opts: any): AsyncGenerator<any> {
  const prompt = opts.prompt || '';

  // Return mock AI responses based on prompt content
  let result = 'mock response';

  if (prompt.includes('industry') || prompt.includes('Industry')) {
    result = 'e-commerce';
  } else if (prompt.includes('Gherkin') || prompt.includes('feature')) {
    result = `Feature: Login
  Scenario: Successful login
    Given I am on the login screen
    When I enter valid credentials
    Then I should see the home screen`;
  } else if (prompt.includes('locator') || prompt.includes('Locator')) {
    result = JSON.stringify({ found: true, strategy: 'accessibility id', value: 'login-button', confidence: 85 });
  } else if (prompt.includes('bug') || prompt.includes('failure')) {
    result = JSON.stringify({ title: 'Test failure', severity: 'medium', steps: ['Step 1'], rootCause: 'Element not found', suggestedFix: 'Update locator' });
  } else if (prompt.includes('screenshot') || prompt.includes('visual')) {
    result = JSON.stringify({ passed: true, confidence: 90, issues: [], description: 'Screen looks correct' });
  } else if (prompt.includes('accessibility') || prompt.includes('fix')) {
    result = JSON.stringify([{ issue: 'missing label', suggestedCode: 'accessibilityLabel="desc"', fileToModify: 'Screen.tsx' }]);
  } else if (prompt.includes('layout')) {
    result = JSON.stringify({ issues: [] });
  }

  yield { result, stop_reason: 'end_turn' };
}
