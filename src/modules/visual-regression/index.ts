import { PipelineContext, ModuleResult } from '../../types';
import { Logger } from '../../utils/logger';
import { DEVICE_MATRIX } from '../../config/devices';
import { PercyAppIntegration, PercyComparisonResult } from './percy-app';
import { DarkModeTester, DarkModeResult } from './dark-mode';
import { DeviceSizeTester, LayoutIssue } from './device-sizes';

export { PercyComparisonResult } from './percy-app';
export { DarkModeResult } from './dark-mode';
export { LayoutIssue } from './device-sizes';

interface VisualRegressionResult {
  comparisons: PercyComparisonResult[];
  darkModeResults: DarkModeResult[];
  layoutIssues: LayoutIssue[];
  percyBuildUrl: string | null;
  summary: {
    totalScreenshots: number;
    diffs: number;
    newScreenshots: number;
    matches: number;
    darkModeScreensTested: number;
    layoutIssueCount: number;
  };
}

export async function runVisualRegression(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('VisualRegression');
  logger.log('Starting visual regression testing');

  const percy = new PercyAppIntegration();
  const comparisons: PercyComparisonResult[] = [];
  let darkModeResults: DarkModeResult[] = [];
  let layoutIssues: LayoutIssue[] = [];
  let percyBuildUrl: string | null = null;

  try {
    const screens = context.codeAnalysis?.screens || [];
    let screenNames = screens.map((s) => s.name);

    // Derive screen names from diff files when static analysis found none
    if (screenNames.length === 0 && context.diffFiles.length > 0) {
      const uiFilePattern = /screen|activity|fragment|composable|viewcontroller|view|page/i;
      screenNames = context.diffFiles
        .filter((f) => uiFilePattern.test(f.path))
        .map((f) => {
          const base = f.path.split('/').pop() || f.path;
          return base.replace(/\.(swift|kt|tsx?|jsx?|dart)$/, '');
        })
        .filter((name, idx, arr) => arr.indexOf(name) === idx);
      if (screenNames.length > 0) {
        logger.log('Derived screen names from diff files', { screens: screenNames });
      }
    }

    if (screenNames.length === 0) {
      logger.warn('No screens identified for visual regression testing');
      return {
        moduleName: 'visual-regression',
        status: 'skipped',
        data: emptyResult(),
        error: 'no screens identified — nothing to compare visually',
      };
    }

    // Start Percy build
    const commitSha = (context as any).commitSha || 'unknown';
    const buildId = await percy.startBuild(`${context.repoOwner}/${context.repoName}`, commitSha, context.branch);

    // Capture screenshots on each available driver
    const androidDriver = (context as any).androidDriver;
    const iosDriver = (context as any).iosDriver;

    if (!androidDriver && !iosDriver) {
      logger.warn('No drivers available — visual screenshots require real device sessions (BrowserStack)');
      return {
        moduleName: 'visual-regression',
        status: 'skipped',
        data: {
          ...emptyResult(),
          pendingScreens: screenNames,
          note: `${screenNames.length} screen(s) identified but could not be tested — no real device sessions available`,
        },
        error: 'no app build — Percy needs a running BrowserStack session to capture screenshots',
      };
    }

    if (androidDriver) {
      for (const screen of screenNames) {
        try {
          await navigateToScreen(androidDriver, screen, 'android');
          await percy.captureScreenshot(androidDriver, `${screen}-android`);
        } catch (err) {
          logger.warn(`Failed to capture Android screenshot: ${screen}`, err);
        }
      }
    }

    if (iosDriver) {
      for (const screen of screenNames) {
        try {
          await navigateToScreen(iosDriver, screen, 'ios');
          await percy.captureScreenshot(iosDriver, `${screen}-ios`);
        } catch (err) {
          logger.warn(`Failed to capture iOS screenshot: ${screen}`, err);
        }
      }
    }

    // Dark mode testing
    const darkModeTester = new DarkModeTester(percy);
    if (androidDriver) {
      const androidResults = await darkModeTester.testBothModes(androidDriver, 'android', screenNames);
      darkModeResults.push(...androidResults);
    }
    if (iosDriver) {
      const iosResults = await darkModeTester.testBothModes(iosDriver, 'ios', screenNames);
      darkModeResults.push(...iosResults);
    }

    // Device size testing
    const deviceSizeTester = new DeviceSizeTester(percy);

    // Capture across different device sizes if multiple drivers available
    const allScreenshotKeys: string[] = [];
    if (androidDriver) {
      for (const screen of screenNames) {
        for (const device of DEVICE_MATRIX.filter((d) => d.platform === 'Android')) {
          const key = `${screen}-${device.name}`.replace(/\s+/g, '-').toLowerCase();
          allScreenshotKeys.push(key);
        }
      }
    }
    if (iosDriver) {
      for (const screen of screenNames) {
        for (const device of DEVICE_MATRIX.filter((d) => d.platform === 'iOS')) {
          const key = `${screen}-${device.name}`.replace(/\s+/g, '-').toLowerCase();
          allScreenshotKeys.push(key);
        }
      }
    }

    // Get comparison results from Percy
    const screenshotMap = await deviceSizeTester.captureAcrossDevices(screenNames, DEVICE_MATRIX);
    layoutIssues = await deviceSizeTester.detectLayoutIssues(screenshotMap);

    // Finalize Percy build and get comparisons
    await percy.finalizeBuild();

    // Only poll Percy if we actually captured screenshots
    if (allScreenshotKeys.length > 0) {
      // Wait for build once, then fetch all comparisons
      const build = await percy.waitForBuildOnce();
      if (build) {
        for (const key of allScreenshotKeys) {
          const result = await percy.compareWithBaseline(key);
          comparisons.push(result);
        }
      }
    }

    // Get Percy build URL
    if (buildId) {
      percyBuildUrl = `https://percy.io/${context.repoOwner}/${context.repoName}/builds/${buildId}`;
    }

    const summary = buildSummary(comparisons, darkModeResults, layoutIssues);
    const hasDiffs = summary.diffs > 0 || summary.layoutIssueCount > 0;

    logger.log('Visual regression testing complete', summary);

    const result: VisualRegressionResult = {
      comparisons,
      darkModeResults,
      layoutIssues,
      percyBuildUrl,
      summary,
    };

    return {
      moduleName: 'visual-regression',
      status: hasDiffs ? 'warning' : 'success',
      data: result,
    };
  } catch (err) {
    logger.error('Visual regression module failed', err);
    try {
      await percy.finalizeBuild();
    } catch {
      /* best effort */
    }

    return {
      moduleName: 'visual-regression',
      status: 'error',
      error: String(err),
      data: emptyResult(),
    };
  }
}

async function navigateToScreen(driver: any, screen: string, platform: string): Promise<void> {
  try {
    if (platform === 'android') {
      await driver.execute('mobile: deepLink', {
        url: `app://screen/${screen.toLowerCase()}`,
        package: await driver.getCurrentPackage(),
      });
    } else {
      await driver.execute('mobile: deepLink', {
        url: `app://screen/${screen.toLowerCase()}`,
      });
    }
    await driver.pause(1000);
  } catch {
    /* screen may already be visible */
  }
}

function buildSummary(
  comparisons: PercyComparisonResult[],
  darkModeResults: DarkModeResult[],
  layoutIssues: LayoutIssue[],
) {
  return {
    totalScreenshots: comparisons.length,
    diffs: comparisons.filter((c) => c.status === 'diff').length,
    newScreenshots: comparisons.filter((c) => c.status === 'new').length,
    matches: comparisons.filter((c) => c.status === 'match').length,
    darkModeScreensTested: darkModeResults.length,
    layoutIssueCount: layoutIssues.length,
  };
}

function emptyResult(): VisualRegressionResult {
  return {
    comparisons: [],
    darkModeResults: [],
    layoutIssues: [],
    percyBuildUrl: null,
    summary: {
      totalScreenshots: 0,
      diffs: 0,
      newScreenshots: 0,
      matches: 0,
      darkModeScreensTested: 0,
      layoutIssueCount: 0,
    },
  };
}
