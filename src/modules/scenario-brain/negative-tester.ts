import { BddScenario, GherkinStep, Screen } from '../../types';
import { Logger } from '../../utils/logger';

interface NegativeTestPattern {
  category: string;
  appliesToElement: (elementType: string, elementId: string) => boolean;
  generate: (screenName: string, elementName: string) => BddScenario;
}

export class NegativeTester {
  private logger = new Logger('NegativeTester');

  generateNegativeTests(screens: Screen[]): BddScenario[] {
    const scenarios: BddScenario[] = [];

    for (const screen of screens) {
      // Input-targeted negative tests
      scenarios.push(...this.generateInputNegativeTests(screen));
      // Form submission negative tests
      scenarios.push(...this.generateSubmissionNegativeTests(screen));
      // Navigation abuse tests
      scenarios.push(...this.generateNavigationNegativeTests(screen));
    }

    // Global negative tests (apply regardless of screens)
    scenarios.push(...this.generateGlobalNegativeTests());

    this.logger.log('Negative tests generated', { total: scenarios.length });
    return scenarios;
  }

  private generateInputNegativeTests(screen: Screen): BddScenario[] {
    const scenarios: BddScenario[] = [];
    const inputs = screen.elements.filter(
      (e) => /input|text|field|edit|textarea/i.test(e.type) || /input|text|field|edit/i.test(e.id),
    );

    for (const input of inputs) {
      const fieldName = input.text || input.id || 'input field';
      const feature = `${screen.name} Negative Tests`;

      // SQL injection
      scenarios.push(
        this.scenario(feature, `SQL injection in ${fieldName}`, [
          { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
          { keyword: 'When', text: `the user enters "'; DROP TABLE users; --" in the ${fieldName} field` },
          { keyword: 'And', text: 'the user submits the form' },
          { keyword: 'Then', text: 'the input should be sanitized or rejected' },
          { keyword: 'And', text: 'no database error should be exposed to the user' },
        ]),
      );

      // XSS attack
      scenarios.push(
        this.scenario(feature, `XSS injection in ${fieldName}`, [
          { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
          { keyword: 'When', text: `the user enters "<script>alert('xss')</script>" in the ${fieldName} field` },
          { keyword: 'And', text: 'the user submits the form' },
          { keyword: 'Then', text: 'the script tags should be escaped or stripped' },
          { keyword: 'And', text: 'no script execution should occur' },
        ]),
      );

      // Extremely long input
      scenarios.push(
        this.scenario(feature, `Extremely long input in ${fieldName}`, [
          { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
          { keyword: 'When', text: `the user enters a 10000 character string in the ${fieldName} field` },
          { keyword: 'Then', text: 'the app should handle the input without crashing' },
          { keyword: 'And', text: 'the input should be truncated or a validation error should appear' },
        ]),
      );

      // Special characters
      scenarios.push(
        this.scenario(feature, `Special characters in ${fieldName}`, [
          { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
          { keyword: 'When', text: `the user enters "!@#$%^&*(){}[]|\\:;"'<>,.?/~\`" in the ${fieldName} field` },
          { keyword: 'And', text: 'the user submits the form' },
          { keyword: 'Then', text: 'special characters should be handled gracefully' },
        ]),
      );

      // Unicode and emoji
      scenarios.push(
        this.scenario(feature, `Unicode and emoji in ${fieldName}`, [
          { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
          {
            keyword: 'When',
            text: `the user enters unicode text with emojis and RTL characters in the ${fieldName} field`,
          },
          { keyword: 'Then', text: 'the text should render correctly without layout issues' },
        ]),
      );

      // Whitespace-only input
      scenarios.push(
        this.scenario(feature, `Whitespace-only input in ${fieldName}`, [
          { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
          { keyword: 'When', text: `the user enters only spaces in the ${fieldName} field` },
          { keyword: 'And', text: 'the user submits the form' },
          { keyword: 'Then', text: 'the field should be treated as empty and show a validation error' },
        ]),
      );

      // Numeric input in text field
      if (!/number|phone|amount|price|quantity/i.test(fieldName)) {
        scenarios.push(
          this.scenario(feature, `Numeric overflow in ${fieldName}`, [
            { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
            { keyword: 'When', text: `the user enters "99999999999999999999" in the ${fieldName} field` },
            { keyword: 'Then', text: 'the app should not crash or show unexpected behavior' },
          ]),
        );
      }

      // Paste attack (clipboard injection)
      scenarios.push(
        this.scenario(feature, `Clipboard paste with malicious content in ${fieldName}`, [
          { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
          { keyword: 'When', text: `the user pastes multiline text with newlines into the ${fieldName} field` },
          { keyword: 'Then', text: 'the input should handle multiline content appropriately' },
        ]),
      );
    }

    return scenarios;
  }

  private generateSubmissionNegativeTests(screen: Screen): BddScenario[] {
    const scenarios: BddScenario[] = [];
    const feature = `${screen.name} Submission Negative Tests`;

    const hasForm = screen.elements.some(
      (e) =>
        /button|submit|save|confirm|send|login|register|signup/i.test(e.type) ||
        /button|submit|save|confirm|send/i.test(e.id),
    );

    if (!hasForm) return scenarios;

    // Empty form submission
    scenarios.push(
      this.scenario(feature, 'Submit form with all fields empty', [
        { keyword: 'Given', text: `the user is on the ${screen.name} screen` },
        { keyword: 'When', text: 'the user taps the submit button without filling any fields' },
        { keyword: 'Then', text: 'validation errors should appear for all required fields' },
        { keyword: 'And', text: 'the form should not be submitted' },
      ]),
    );

    // Rapid double-tap submission
    scenarios.push(
      this.scenario(feature, 'Rapid double-tap on submit button', [
        { keyword: 'Given', text: `the user is on the ${screen.name} screen with valid data filled` },
        { keyword: 'When', text: 'the user rapidly taps the submit button twice in quick succession' },
        { keyword: 'Then', text: 'the form should only be submitted once' },
        { keyword: 'And', text: 'no duplicate entries should be created' },
      ]),
    );

    // Submit during network error
    scenarios.push(
      this.scenario(feature, 'Submit form with no network', [
        { keyword: 'Given', text: `the user is on the ${screen.name} screen with valid data filled` },
        { keyword: 'And', text: 'the device has no network connectivity' },
        { keyword: 'When', text: 'the user taps the submit button' },
        { keyword: 'Then', text: 'the user should see an appropriate offline error message' },
        { keyword: 'And', text: 'entered data should not be lost' },
      ]),
    );

    return scenarios;
  }

  private generateNavigationNegativeTests(screen: Screen): BddScenario[] {
    const scenarios: BddScenario[] = [];
    const feature = `${screen.name} Navigation Negative Tests`;

    // Back button during data entry
    const hasInputs = screen.elements.some(
      (e) => /input|text|field|edit/i.test(e.type) || /input|text|field|edit/i.test(e.id),
    );

    if (hasInputs) {
      scenarios.push(
        this.scenario(feature, 'Back button with unsaved changes', [
          { keyword: 'Given', text: `the user is on the ${screen.name} screen with partially filled form` },
          { keyword: 'When', text: 'the user presses the back button' },
          { keyword: 'Then', text: 'the user should see a discard changes confirmation dialog' },
        ]),
      );
    }

    // Orientation change
    scenarios.push(
      this.scenario(feature, 'Orientation change preserves state', [
        { keyword: 'Given', text: `the user is on the ${screen.name} screen with data entered` },
        { keyword: 'When', text: 'the device orientation changes from portrait to landscape' },
        { keyword: 'Then', text: 'all entered data should be preserved' },
        { keyword: 'And', text: 'the screen layout should adapt correctly' },
      ]),
    );

    return scenarios;
  }

  private generateGlobalNegativeTests(): BddScenario[] {
    const feature = 'Global Negative Tests';
    return [
      this.scenario(feature, 'App launch with no network', [
        { keyword: 'Given', text: 'the device has no network connectivity' },
        { keyword: 'When', text: 'the user launches the app' },
        { keyword: 'Then', text: 'the app should show an offline state or cached content' },
        { keyword: 'And', text: 'the app should not crash' },
      ]),
      this.scenario(feature, 'App launch with low memory', [
        { keyword: 'Given', text: 'the device is in a low memory condition' },
        { keyword: 'When', text: 'the user launches the app' },
        { keyword: 'Then', text: 'the app should launch successfully or show a graceful error' },
      ]),
      this.scenario(feature, 'Force close and reopen app', [
        { keyword: 'Given', text: 'the user is on any screen with active state' },
        { keyword: 'When', text: 'the user force closes the app and reopens it' },
        { keyword: 'Then', text: 'the app should launch to a valid state' },
        { keyword: 'And', text: 'no crash report should be generated' },
      ]),
      this.scenario(feature, 'Incoming call interruption', [
        { keyword: 'Given', text: 'the user is performing an action in the app' },
        { keyword: 'When', text: 'an incoming phone call interrupts the app' },
        { keyword: 'And', text: 'the user dismisses the call and returns to the app' },
        { keyword: 'Then', text: 'the app should resume at the same state' },
      ]),
      this.scenario(feature, 'System notification overlay', [
        { keyword: 'Given', text: 'the user is interacting with the app' },
        { keyword: 'When', text: 'a system notification appears as an overlay' },
        { keyword: 'Then', text: 'the app should continue functioning correctly beneath the notification' },
      ]),
      this.scenario(feature, 'Permission denial for all permissions', [
        { keyword: 'Given', text: 'the user has denied all app permissions' },
        { keyword: 'When', text: 'the user navigates through the app' },
        { keyword: 'Then', text: 'features requiring permissions should show appropriate fallback UI' },
        { keyword: 'And', text: 'the app should not crash' },
      ]),
    ];
  }

  private scenario(feature: string, scenario: string, steps: GherkinStep[]): BddScenario {
    return { feature, scenario, steps };
  }
}
