import { Logger } from '../../utils/logger';
import { getThresholds } from '../../config/thresholds';
import { AccessibilityIssue } from './android-a11y';

const IOS_MIN_TAP_TARGET_PT = 44;

export class IosAccessibilityChecker {
  private logger = new Logger('iOSA11y');
  private thresholds = getThresholds();

  analyzeScreenStatically(screen: { name: string; elements: Array<{ id: string; accessibilityId?: string; text?: string }> }): AccessibilityIssue[] {
    const issues: AccessibilityIssue[] = [];
    for (const el of screen.elements) {
      if (!el.accessibilityId && !el.text) {
        issues.push({
          type: 'missing-label',
          severity: 'major',
          element: el.id || 'unknown',
          message: `Element "${el.id}" in ${screen.name} has no accessibilityLabel or accessibilityIdentifier`,
          suggestion: 'Add .accessibilityLabel("...") or .accessibilityIdentifier("...") for VoiceOver support',
          platform: 'ios',
        });
      }
    }
    return issues;
  }

  async checkScreen(driver: any): Promise<AccessibilityIssue[]> {
    const issues: AccessibilityIssue[] = [];

    try {
      const elements = await this.getInteractiveElements(driver);

      for (const el of elements) {
        issues.push(...(await this.checkElement(driver, el)));
      }

      issues.push(...(await this.checkVoiceOverOrder(driver)));
      issues.push(...(await this.checkAccessibilityTraits(driver)));

      this.logger.log('iOS a11y check complete', { issueCount: issues.length });
    } catch (err) {
      this.logger.error('iOS a11y check failed', err);
    }

    return issues;
  }

  private async getInteractiveElements(driver: any): Promise<any[]> {
    try {
      const buttons = await driver.$$('//XCUIElementTypeButton');
      const links = await driver.$$('//XCUIElementTypeLink');
      const textFields = await driver.$$('//XCUIElementTypeTextField');
      const secureFields = await driver.$$('//XCUIElementTypeSecureTextField');
      const switches = await driver.$$('//XCUIElementTypeSwitch');
      const sliders = await driver.$$('//XCUIElementTypeSlider');
      const cells = await driver.$$('//XCUIElementTypeCell');
      return [...buttons, ...links, ...textFields, ...secureFields, ...switches, ...sliders, ...cells];
    } catch {
      return [];
    }
  }

  private async checkElement(driver: any, el: any): Promise<AccessibilityIssue[]> {
    const issues: AccessibilityIssue[] = [];
    const label = (await el.getAttribute('label').catch(() => '')) || '';
    const name = (await el.getAttribute('name').catch(() => '')) || '';
    const value = (await el.getAttribute('value').catch(() => '')) || '';
    const type = (await el.getAttribute('type').catch(() => '')) || '';
    const accessible = await el.getAttribute('accessible').catch(() => 'true');
    const elementName = label || name || type;

    // Check VoiceOver label
    if (accessible !== 'false' && !label && !name) {
      issues.push({
        type: 'missing-label',
        severity: 'critical',
        element: elementName || `Unlabeled ${type}`,
        message: `Interactive element of type "${type}" has no accessibility label for VoiceOver`,
        suggestion: 'Set accessibilityLabel on this element (e.g., button.accessibilityLabel = "Submit")',
        platform: 'ios',
      });
    }

    // Check for generic labels
    if (label && ['button', 'image', 'icon', 'view', 'cell'].includes(label.toLowerCase())) {
      issues.push({
        type: 'missing-label',
        severity: 'major',
        element: elementName,
        message: `Element has generic accessibility label "${label}" which is not helpful for VoiceOver users`,
        suggestion: 'Use a descriptive label like "Submit order" instead of "button"',
        platform: 'ios',
      });
    }

    // Check accessibility hint for complex actions
    const hint = (await el.getAttribute('hint').catch(() => '')) || '';
    if (type.includes('Button') && !hint && label && label.length < 3) {
      issues.push({
        type: 'missing-description',
        severity: 'minor',
        element: elementName,
        message: `Button "${label}" has a very short label and no accessibility hint`,
        suggestion: 'Add accessibilityHint to describe the result of the action',
        platform: 'ios',
      });
    }

    // Check minimum tap target size (44pt on iOS)
    try {
      const size = await el.getSize();
      if (size && (size.width < IOS_MIN_TAP_TARGET_PT || size.height < IOS_MIN_TAP_TARGET_PT)) {
        issues.push({
          type: 'small-target',
          severity: 'major',
          element: elementName,
          message: `Tap target "${elementName}" is ${size.width}x${size.height}pt, below iOS minimum ${IOS_MIN_TAP_TARGET_PT}pt`,
          suggestion: `Increase the tappable area to at least ${IOS_MIN_TAP_TARGET_PT}x${IOS_MIN_TAP_TARGET_PT}pt`,
          platform: 'ios',
        });
      }
    } catch {
      /* optional */
    }

    // Check images without labels
    if (type.includes('Image') && !label) {
      issues.push({
        type: 'missing-label',
        severity: 'major',
        element: name || 'Unknown image',
        message: `Image element is missing accessibility label`,
        suggestion: 'Add accessibilityLabel or set isAccessibilityElement = false if decorative',
        platform: 'ios',
      });
    }

    return issues;
  }

  private async checkVoiceOverOrder(driver: any): Promise<AccessibilityIssue[]> {
    const issues: AccessibilityIssue[] = [];

    try {
      const accessibleElements = await driver.$$('//*[@accessible="true"]');
      if (accessibleElements.length < 2) return issues;

      const positions: { label: string; y: number; x: number; index: number }[] = [];
      for (let i = 0; i < Math.min(accessibleElements.length, 50); i++) {
        const loc = await accessibleElements[i].getLocation().catch(() => null);
        const label = await accessibleElements[i].getAttribute('label').catch(() => `element-${i}`);
        if (loc) {
          positions.push({ label: label || `element-${i}`, y: loc.y, x: loc.x, index: i });
        }
      }

      // VoiceOver reads top-to-bottom, left-to-right. Check for significant jumps.
      for (let i = 1; i < positions.length; i++) {
        const prev = positions[i - 1];
        const curr = positions[i];
        if (curr.y < prev.y - 80) {
          issues.push({
            type: 'focus-order',
            severity: 'major',
            element: curr.label,
            message: `VoiceOver reading order issue: "${curr.label}" is read after "${prev.label}" but appears above it`,
            suggestion:
              'Adjust accessibilityElements ordering on the parent container or use shouldGroupAccessibilityChildren',
            platform: 'ios',
          });
        }
      }
    } catch {
      /* optional */
    }

    return issues;
  }

  private async checkAccessibilityTraits(driver: any): Promise<AccessibilityIssue[]> {
    const issues: AccessibilityIssue[] = [];

    try {
      // Check that headers are marked with header trait
      const staticTexts = await driver.$$('//XCUIElementTypeStaticText');
      for (const el of staticTexts) {
        const label = (await el.getAttribute('label').catch(() => '')) || '';
        const rect = await el.getSize().catch(() => null);

        // Heuristic: large text likely a heading — should have header trait
        if (rect && rect.height > 30 && label.length > 0 && label.length < 50) {
          const traits = await el.getAttribute('traits').catch(() => null);
          // traits is a bitmask; header trait = 0x00000010
          if (traits !== null && !(parseInt(traits, 10) & 0x10)) {
            issues.push({
              type: 'missing-description',
              severity: 'minor',
              element: label,
              message: `Large text "${label}" may be a heading but lacks the header accessibility trait`,
              suggestion: 'Add .accessibilityTraits = .header to help VoiceOver users navigate by headings',
              platform: 'ios',
            });
          }
        }
      }

      // Check that buttons have button trait
      const buttons = await driver.$$('//XCUIElementTypeOther[@accessible="true"]');
      for (const btn of buttons.slice(0, 20)) {
        const label = (await btn.getAttribute('label').catch(() => '')) || '';
        if (
          label.toLowerCase().includes('tap') ||
          label.toLowerCase().includes('click') ||
          label.toLowerCase().includes('press')
        ) {
          issues.push({
            type: 'missing-description',
            severity: 'major',
            element: label,
            message: `Element "${label}" has action-oriented label but may not have button trait`,
            suggestion: 'Use UIButton or set accessibilityTraits = .button so VoiceOver announces it as a button',
            platform: 'ios',
          });
        }
      }
    } catch {
      /* optional */
    }

    return issues;
  }
}
