/**
 * Tests for the getElementIdRules helper and platform-specific prompt generation
 * in the ScenarioBrain module.
 *
 * We import the function indirectly by testing the prompt output,
 * since getElementIdRules is not exported. We test via the prompt template instead.
 */
import { getFeatureGenerationPrompt } from '../src/ai/prompts/feature-generation';

describe('Feature Generation Prompt', () => {
  it('includes React Native element ID guidance', () => {
    const prompt = getFeatureGenerationPrompt('e-commerce', 'Checkout', ['Cart', 'Payment'], 'react-native');
    expect(prompt).toContain('testID');
    expect(prompt).toContain('react-native');
    expect(prompt).toContain('e-commerce');
  });

  it('includes Swift/iOS element ID guidance', () => {
    const prompt = getFeatureGenerationPrompt('banking', 'Login', ['LoginScreen'], 'swift');
    expect(prompt).toContain('accessibilityIdentifier');
    expect(prompt).toContain('accessibilityLabel');
    expect(prompt).toContain('SwiftUI');
    expect(prompt).toContain('(swift)');
  });

  it('includes Kotlin/Android element ID guidance', () => {
    const prompt = getFeatureGenerationPrompt('social', 'Feed', ['FeedScreen'], 'kotlin');
    expect(prompt).toContain('resource-id');
    expect(prompt).toContain('contentDescription');
    expect(prompt).toContain('testTag');
    expect(prompt).toContain('Jetpack Compose');
    expect(prompt).toContain('(kotlin)');
  });

  it('includes Flutter element ID guidance', () => {
    const prompt = getFeatureGenerationPrompt('health', 'Dashboard', ['HomeScreen'], 'flutter');
    expect(prompt).toContain('Key');
    expect(prompt).toContain('Semantics');
    expect(prompt).toContain('(flutter)');
  });

  it('uses generic guidance for native/unknown framework', () => {
    const prompt = getFeatureGenerationPrompt('generic', 'Main', ['MainScreen'], 'native');
    expect(prompt).toContain('accessibility IDs');
    expect(prompt).not.toContain('(native)');
  });

  it('uses generic guidance when framework is undefined', () => {
    const prompt = getFeatureGenerationPrompt('generic', 'Main', ['MainScreen']);
    expect(prompt).toContain('accessibility IDs');
  });

  it('includes Appium Gherkin syntax rules regardless of framework', () => {
    const frameworks = ['react-native', 'swift', 'kotlin', 'flutter', 'native', undefined];
    for (const fw of frameworks) {
      const prompt = getFeatureGenerationPrompt('generic', 'Flow', ['Screen'], fw);
      expect(prompt).toContain('TAP:');
      expect(prompt).toContain('TYPE:');
      expect(prompt).toContain('ASSERT VISIBLE:');
      expect(prompt).toContain('ASSERT TEXT:');
    }
  });

  it('includes screen names in the prompt', () => {
    const prompt = getFeatureGenerationPrompt('e-commerce', 'Checkout', ['CartScreen', 'PaymentScreen', 'ConfirmScreen'], 'react-native');
    expect(prompt).toContain('CartScreen → PaymentScreen → ConfirmScreen');
  });
});
