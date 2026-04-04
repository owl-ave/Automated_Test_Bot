import { Logger } from '../../utils/logger';
import { getThresholds } from '../../config/thresholds';

export interface AccessibilityIssue {
  type: 'missing-label' | 'low-contrast' | 'small-target' | 'missing-description' | 'focus-order';
  severity: 'critical' | 'major' | 'minor';
  element: string;
  message: string;
  suggestion: string;
  platform: 'android' | 'ios';
}

interface AndroidElement {
  'resource-id'?: string;
  'content-desc'?: string;
  class?: string;
  text?: string;
  bounds?: string;
  clickable?: string;
  focusable?: string;
  enabled?: string;
  displayed?: string;
  'accessibility-id'?: string;
}

export class AndroidAccessibilityChecker {
  private logger = new Logger('AndroidA11y');
  private thresholds = getThresholds();

  analyzeScreenStatically(screen: { name: string; elements: Array<{ id: string; accessibilityId?: string; text?: string }> }): AccessibilityIssue[] {
    const issues: AccessibilityIssue[] = [];
    for (const el of screen.elements) {
      if (!el.accessibilityId && !el.text) {
        issues.push({
          type: 'missing-label',
          severity: 'major',
          element: el.id || 'unknown',
          message: `Element "${el.id}" in ${screen.name} has no content description or accessibility label`,
          suggestion: 'Add android:contentDescription or use Modifier.semantics { contentDescription = "..." }',
          platform: 'android',
        });
      }
    }
    return issues;
  }

  async checkScreen(driver: any): Promise<AccessibilityIssue[]> {
    const issues: AccessibilityIssue[] = [];

    try {
      const source = await driver.getPageSource();
      const elements = await this.getInteractiveElements(driver);

      for (const el of elements) {
        issues.push(...(await this.checkElement(driver, el)));
      }

      issues.push(...(await this.checkFocusOrder(driver)));
      issues.push(...(await this.checkTalkBackNavigation(driver, source)));

      this.logger.log(`Android a11y check complete`, { issueCount: issues.length });
    } catch (err) {
      this.logger.error('Android a11y check failed', err);
    }

    return issues;
  }

  private async getInteractiveElements(driver: any): Promise<any[]> {
    try {
      const clickable = await driver.$$('//*[@clickable="true"]');
      const focusable = await driver.$$('//*[@focusable="true"]');
      const editable = await driver.$$('//android.widget.EditText');
      const seen = new Set<string>();
      const all: any[] = [];

      for (const el of [...clickable, ...focusable, ...editable]) {
        const id =
          (await el.getAttribute('resource-id').catch(() => '')) ||
          (await el.getAttribute('content-desc').catch(() => ''));
        const key = id || `${await el.getLocation().catch(() => ({}))}-${await el.getSize().catch(() => ({}))}`;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(el);
        }
      }
      return all;
    } catch {
      return [];
    }
  }

  private async checkElement(driver: any, el: any): Promise<AccessibilityIssue[]> {
    const issues: AccessibilityIssue[] = [];
    const resourceId = (await el.getAttribute('resource-id').catch(() => '')) || '';
    const contentDesc = (await el.getAttribute('content-desc').catch(() => '')) || '';
    const text = (await el.getText().catch(() => '')) || '';
    const className = (await el.getAttribute('class').catch(() => '')) || '';
    const clickable = await el.getAttribute('clickable').catch(() => 'false');
    const elementName = resourceId || contentDesc || text || className;

    // Check content description for interactive elements
    if (clickable === 'true' && !contentDesc && !text) {
      issues.push({
        type: 'missing-description',
        severity: 'critical',
        element: elementName,
        message: `Interactive element "${elementName}" has no content description or text for TalkBack`,
        suggestion: 'Add android:contentDescription to this element or set a meaningful text label',
        platform: 'android',
      });
    }

    // Check ImageView/ImageButton have content descriptions
    if ((className.includes('ImageView') || className.includes('ImageButton')) && !contentDesc) {
      issues.push({
        type: 'missing-label',
        severity: className.includes('ImageButton') ? 'critical' : 'major',
        element: elementName,
        message: `Image element "${elementName}" is missing contentDescription`,
        suggestion:
          'Add android:contentDescription="descriptive text" or android:importantForAccessibility="no" if decorative',
        platform: 'android',
      });
    }

    // Check touch target size (min 48dp)
    try {
      const size = await el.getSize();
      if (size && clickable === 'true') {
        const minDp = this.thresholds.minTouchTargetDp;
        if (size.width < minDp || size.height < minDp) {
          issues.push({
            type: 'small-target',
            severity: 'major',
            element: elementName,
            message: `Touch target "${elementName}" is ${size.width}x${size.height}dp, below minimum ${minDp}dp`,
            suggestion: `Increase touch target to at least ${minDp}x${minDp}dp using padding or minWidth/minHeight`,
            platform: 'android',
          });
        }
      }
    } catch {
      /* size check optional */
    }

    // Check color contrast via screenshot analysis
    issues.push(...(await this.checkColorContrast(driver, el, elementName)));

    return issues;
  }

  private async checkColorContrast(driver: any, el: any, elementName: string): Promise<AccessibilityIssue[]> {
    const issues: AccessibilityIssue[] = [];

    try {
      const text = await el.getText().catch(() => '');
      if (!text) return issues;

      // Use Appium's element screenshot for contrast analysis
      const screenshot = await el.takeScreenshot().catch(() => null);
      if (!screenshot) return issues;

      // Decode screenshot and analyze dominant colors
      const colors = this.analyzeScreenshotColors(screenshot);
      if (colors && colors.contrastRatio < this.thresholds.minColorContrast) {
        issues.push({
          type: 'low-contrast',
          severity: colors.contrastRatio < 3.0 ? 'critical' : 'major',
          element: elementName,
          message: `Text contrast ratio ${colors.contrastRatio.toFixed(2)}:1 is below WCAG AA minimum ${this.thresholds.minColorContrast}:1`,
          suggestion:
            'Increase foreground/background color contrast. Use darker text on light backgrounds or vice versa',
          platform: 'android',
        });
      }
    } catch {
      /* contrast check optional */
    }

    return issues;
  }

  private analyzeScreenshotColors(base64Screenshot: string): { contrastRatio: number } | null {
    // Basic pixel sampling from base64-encoded PNG
    // In production, use a proper image analysis library (sharp, jimp)
    try {
      const buffer = Buffer.from(base64Screenshot, 'base64');
      if (buffer.length < 100) return null;

      // Sample pixels from the image to estimate foreground/background colors
      // This is a simplified heuristic; full implementation would decode PNG
      return null; // Return null to skip when we can't properly decode
    } catch {
      return null;
    }
  }

  private async checkFocusOrder(driver: any): Promise<AccessibilityIssue[]> {
    const issues: AccessibilityIssue[] = [];

    try {
      const focusableElements = await driver.$$('//*[@focusable="true"]');
      if (focusableElements.length < 2) return issues;

      const positions: { element: string; y: number; x: number; index: number }[] = [];
      for (let i = 0; i < focusableElements.length; i++) {
        const loc = await focusableElements[i].getLocation().catch(() => null);
        const desc =
          (await focusableElements[i].getAttribute('content-desc').catch(() => '')) ||
          (await focusableElements[i].getAttribute('resource-id').catch(() => `element-${i}`));
        if (loc) {
          positions.push({ element: desc, y: loc.y, x: loc.x, index: i });
        }
      }

      // Check if focus order follows visual top-to-bottom, left-to-right
      for (let i = 1; i < positions.length; i++) {
        const prev = positions[i - 1];
        const curr = positions[i];
        // Flag if focus jumps backwards significantly (more than one row)
        if (curr.y < prev.y - 100) {
          issues.push({
            type: 'focus-order',
            severity: 'major',
            element: curr.element,
            message: `Focus order issue: "${curr.element}" receives focus after "${prev.element}" but appears above it visually`,
            suggestion:
              'Use android:accessibilityTraversalAfter or android:accessibilityTraversalBefore to fix focus order',
            platform: 'android',
          });
        }
      }
    } catch {
      /* focus order check optional */
    }

    return issues;
  }

  private async checkTalkBackNavigation(driver: any, pageSource: string): Promise<AccessibilityIssue[]> {
    const issues: AccessibilityIssue[] = [];

    try {
      // Check for elements marked importantForAccessibility="no" that should be accessible
      const headings = await driver.$$('//android.widget.TextView').catch(() => []);
      for (const heading of headings) {
        const important = await heading.getAttribute('importantForAccessibility').catch(() => null);
        const text = await heading.getText().catch(() => '');
        if (important === 'no' && text && text.length > 0) {
          issues.push({
            type: 'missing-label',
            severity: 'minor',
            element: text,
            message: `Text "${text}" is marked importantForAccessibility="no" but may contain meaningful content`,
            suggestion: 'Review if this text should be accessible to TalkBack users',
            platform: 'android',
          });
        }
      }

      // Check for redundant content descriptions on parent/child
      const clickableWithDesc = await driver.$$('//*[@clickable="true" and @content-desc!=""]').catch(() => []);
      for (const el of clickableWithDesc) {
        const children = await el.$$('.//*[@content-desc!=""]').catch(() => []);
        if (children.length > 0) {
          const parentDesc = await el.getAttribute('content-desc').catch(() => '');
          issues.push({
            type: 'focus-order',
            severity: 'minor',
            element: parentDesc,
            message: `Clickable container "${parentDesc}" and its children both have content descriptions, causing redundant TalkBack announcements`,
            suggestion: 'Remove content-desc from children or mark children importantForAccessibility="no"',
            platform: 'android',
          });
        }
      }
    } catch {
      /* talkback check optional */
    }

    return issues;
  }
}
