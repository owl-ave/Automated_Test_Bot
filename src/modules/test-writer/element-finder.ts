import { Screen, Element } from '../../types';
import { Logger } from '../../utils/logger';

export class ElementFinder {
  private logger = new Logger('ElementFinder');

  findElement(screens: Screen[], elementDescription: string): Element | null {
    const desc = elementDescription.toLowerCase();

    for (const screen of screens) {
      const match = screen.elements.find(
        (e) =>
          (e.text && e.text.toLowerCase().includes(desc)) ||
          (e.id && e.id.toLowerCase().includes(desc)) ||
          (e.accessibilityId && e.accessibilityId.toLowerCase().includes(desc)),
      );
      if (match) return match;
    }

    // Fallback: create element with description
    this.logger.warn(`Element not found, using description as locator: ${elementDescription}`);
    return {
      id: 'unknown',
      type: 'unknown',
      text: elementDescription,
      accessibilityId: elementDescription.replace(/\s+/g, '_').toLowerCase(),
    };
  }

  generateLocatorStrategy(element: Element, framework?: string): string {
    if (framework === 'swift') {
      // iOS: accessibility identifier → label → name → xpath
      if (element.accessibilityId) return `$('~${element.accessibilityId}')`;
      if (element.text) return `$('-ios predicate string:label == "${element.text}"')`;
      return `$('~${element.id}')`;
    }
    if (framework === 'kotlin') {
      // Android: resource-id → content-desc → text → xpath
      if (element.resourceId) return `$('android=new UiSelector().resourceId("${element.resourceId}")')`;
      if (element.accessibilityId) return `$('~${element.accessibilityId}')`;
      if (element.text) return `$('//*[@text="${element.text}"]')`;
      return `$('~${element.id}')`;
    }
    // React Native / Flutter / generic: accessibility id → resource id → text
    if (element.accessibilityId) return `$('~${element.accessibilityId}')`;
    if (element.resourceId) return `$('id=${element.resourceId}')`;
    if (element.text) return `$('//*[@text="${element.text}"]')`;
    return `$('~${element.id}')`;
  }
}
