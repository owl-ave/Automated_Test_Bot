import { PipelineContext, ModuleResult } from '../../types';
import { Logger } from '../../utils/logger';
import { AndroidAccessibilityChecker, AccessibilityIssue } from './android-a11y';
import { IosAccessibilityChecker } from './ios-a11y';
import { AccessibilityFixSuggester, AccessibilityFix } from './fix-suggester';

export { AccessibilityIssue } from './android-a11y';
export { AccessibilityFix } from './fix-suggester';

interface AccessibilityResult {
  issues: AccessibilityIssue[];
  fixes: AccessibilityFix[];
  summary: {
    total: number;
    critical: number;
    major: number;
    minor: number;
    byType: Record<string, number>;
  };
}

export async function runAccessibility(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('Accessibility');
  logger.log('Starting accessibility checks');

  const allIssues: AccessibilityIssue[] = [];

  try {
    const framework = context.codeAnalysis?.framework || 'react-native';
    const screens = context.codeAnalysis?.screens || [];

    // Determine which platforms to test based on app build
    const testAndroid = !!context.appBuild?.androidAppUrl;
    const testIos = !!context.appBuild?.iosAppUrl;

    if (!testAndroid && !testIos) {
      logger.warn('No app builds available for accessibility testing');
      return {
        moduleName: 'accessibility',
        status: 'warning',
        data: { issues: [], fixes: [], summary: emptySummary() },
        error: 'No app builds available',
      };
    }

    // Run Android accessibility checks
    if (testAndroid) {
      const androidChecker = new AndroidAccessibilityChecker();
      const androidDriver = (context as any).androidDriver;

      if (androidDriver) {
        for (const screen of screens) {
          try {
            await navigateToScreen(androidDriver, screen.name, 'android');
            const issues = await androidChecker.checkScreen(androidDriver);
            allIssues.push(...issues);
          } catch (err) {
            logger.warn(`Failed to check Android screen: ${screen.name}`, err);
          }
        }

        // Check current screen if no specific screens
        if (screens.length === 0) {
          const issues = await androidChecker.checkScreen(androidDriver);
          allIssues.push(...issues);
        }
      } else {
        logger.warn('No Android driver available for accessibility testing');
      }
    }

    // Run iOS accessibility checks
    if (testIos) {
      const iosChecker = new IosAccessibilityChecker();
      const iosDriver = (context as any).iosDriver;

      if (iosDriver) {
        for (const screen of screens) {
          try {
            await navigateToScreen(iosDriver, screen.name, 'ios');
            const issues = await iosChecker.checkScreen(iosDriver);
            allIssues.push(...issues);
          } catch (err) {
            logger.warn(`Failed to check iOS screen: ${screen.name}`, err);
          }
        }

        if (screens.length === 0) {
          const issues = await iosChecker.checkScreen(iosDriver);
          allIssues.push(...issues);
        }
      } else {
        logger.warn('No iOS driver available for accessibility testing');
      }
    }

    // Generate fix suggestions
    let fixes: AccessibilityFix[] = [];
    if (process.env.CLAUDE_AUTH_TOKEN && allIssues.length > 0) {
      const suggester = new AccessibilityFixSuggester();
      fixes = await suggester.suggestFixes(allIssues, framework);
    }

    const summary = buildSummary(allIssues);
    const hasCritical = summary.critical > 0;

    logger.log('Accessibility checks complete', summary);

    const result: AccessibilityResult = { issues: allIssues, fixes, summary };

    return {
      moduleName: 'accessibility',
      status: hasCritical ? 'error' : allIssues.length > 0 ? 'warning' : 'success',
      data: result,
    };
  } catch (err) {
    logger.error('Accessibility module failed', err);
    return {
      moduleName: 'accessibility',
      status: 'error',
      error: String(err),
      data: { issues: allIssues, fixes: [], summary: buildSummary(allIssues) },
    };
  }
}

async function navigateToScreen(driver: any, screenName: string, platform: string): Promise<void> {
  // Try deep link navigation first
  try {
    if (platform === 'android') {
      await driver.execute('mobile: deepLink', {
        url: `app://screen/${screenName.toLowerCase()}`,
        package: await driver.getCurrentPackage(),
      });
    } else {
      await driver.execute('mobile: deepLink', {
        url: `app://screen/${screenName.toLowerCase()}`,
      });
    }
    await driver.pause(1000);
  } catch {
    // Deep link not available; screen may already be visible
  }
}

function buildSummary(issues: AccessibilityIssue[]) {
  const byType: Record<string, number> = {};
  for (const issue of issues) {
    byType[issue.type] = (byType[issue.type] || 0) + 1;
  }

  return {
    total: issues.length,
    critical: issues.filter((i) => i.severity === 'critical').length,
    major: issues.filter((i) => i.severity === 'major').length,
    minor: issues.filter((i) => i.severity === 'minor').length,
    byType,
  };
}

function emptySummary() {
  return { total: 0, critical: 0, major: 0, minor: 0, byType: {} };
}
