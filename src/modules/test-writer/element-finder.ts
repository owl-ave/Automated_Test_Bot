import { Screen, Element } from '../../types';
import { Logger } from '../../utils/logger';

export interface DeferredElement {
  deferred: true;
  hint: string;
}

export type ElementOrDeferred = Element | DeferredElement;

export function isDeferred(e: ElementOrDeferred | null): e is DeferredElement {
  return !!e && (e as DeferredElement).deferred === true;
}

export class ElementFinder {
  private logger = new Logger('ElementFinder');

  findElement(screens: Screen[], elementDescription: string): ElementOrDeferred {
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

    // Static analysis didn't find a match. Instead of returning null and crashing the
    // scenario at write time, return a deferred placeholder carrying the original
    // hint. The runtime ElementResolver will look it up against the live page source
    // and (most of the time) find it without any test code change.
    this.logger.debug(`Deferring element resolution to runtime: ${elementDescription}`);
    return { deferred: true, hint: elementDescription };
  }

  generateLocatorStrategy(element: Element, framework?: string): string {
    if (framework === 'swift') {
      if (element.accessibilityId) return `$('~${element.accessibilityId}')`;
      if (element.text) return `$('-ios predicate string:label == "${this.escapeDoubleQuotes(element.text)}"')`;
      return `$('~${element.id}')`;
    }
    if (framework === 'kotlin') {
      if (element.resourceId)
        return `$('android=new UiSelector().resourceId("${this.escapeDoubleQuotes(element.resourceId)}")')`;
      if (element.accessibilityId) return `$('~${element.accessibilityId}')`;
      if (element.text) return `$('//*[@text="${this.escapeDoubleQuotes(element.text)}"]')`;
      return `$('~${element.id}')`;
    }
    // React Native / Flutter / generic
    if (element.accessibilityId) return `$('~${element.accessibilityId}')`;
    if (element.resourceId)
      return `$('android=new UiSelector().resourceId("${this.escapeDoubleQuotes(element.resourceId)}")')`;
    if (element.text) return `$('//*[@text="${this.escapeDoubleQuotes(element.text)}"]')`;
    return `$('~${element.id}')`;
  }

  private escapeDoubleQuotes(value: string): string {
    return value.replace(/"/g, '\\"');
  }
}
