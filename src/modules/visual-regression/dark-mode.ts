import { Logger } from '../../utils/logger';
import { PercyAppIntegration, PercyComparisonResult } from './percy-app';

export interface DarkModeResult {
  screen: string;
  lightScreenshot: string | null;
  darkScreenshot: string | null;
  comparison: PercyComparisonResult | null;
}

export class DarkModeTester {
  private logger = new Logger('DarkMode');
  private percy: PercyAppIntegration;

  constructor(percy: PercyAppIntegration) {
    this.percy = percy;
  }

  async enableDarkMode(driver: any, platform: 'android' | 'ios'): Promise<void> {
    try {
      if (platform === 'android') {
        await driver.execute('mobile: shell', {
          command: 'cmd',
          args: ['uimode', 'night', 'yes'],
        });
      } else {
        await driver.execute('mobile: setAppearance', { style: 'dark' });
      }
      // Wait for theme transition
      await driver.pause(1500);
      this.logger.log(`Dark mode enabled on ${platform}`);
    } catch (err) {
      this.logger.error(`Failed to enable dark mode on ${platform}`, err);
      throw err;
    }
  }

  async disableDarkMode(driver: any, platform: 'android' | 'ios'): Promise<void> {
    try {
      if (platform === 'android') {
        await driver.execute('mobile: shell', {
          command: 'cmd',
          args: ['uimode', 'night', 'no'],
        });
      } else {
        await driver.execute('mobile: setAppearance', { style: 'light' });
      }
      await driver.pause(1500);
      this.logger.log(`Dark mode disabled on ${platform}`);
    } catch (err) {
      this.logger.error(`Failed to disable dark mode on ${platform}`, err);
      throw err;
    }
  }

  async testBothModes(driver: any, platform: string, screensToTest: string[]): Promise<DarkModeResult[]> {
    const results: DarkModeResult[] = [];
    const plat = platform.toLowerCase() as 'android' | 'ios';

    for (const screen of screensToTest) {
      const result: DarkModeResult = {
        screen,
        lightScreenshot: null,
        darkScreenshot: null,
        comparison: null,
      };

      try {
        // Ensure light mode first
        await this.disableDarkMode(driver, plat);
        await this.navigateToScreen(driver, screen, plat);
        result.lightScreenshot = await this.percy.captureScreenshot(driver, `${screen}-light`);

        // Switch to dark mode
        await this.enableDarkMode(driver, plat);
        await driver.pause(500);
        result.darkScreenshot = await this.percy.captureScreenshot(driver, `${screen}-dark`);

        // Compare both against baselines
        result.comparison = await this.percy.compareWithBaseline(`${screen}-dark`);
      } catch (err) {
        this.logger.error(`Dark mode test failed for screen: ${screen}`, err);
      } finally {
        // Restore light mode
        try {
          await this.disableDarkMode(driver, plat);
        } catch {
          /* best effort */
        }
      }

      results.push(result);
    }

    this.logger.log('Dark mode testing complete', { screensTested: results.length });
    return results;
  }

  private async navigateToScreen(driver: any, screen: string, platform: 'android' | 'ios'): Promise<void> {
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
      // Screen may already be visible
    }
  }
}
