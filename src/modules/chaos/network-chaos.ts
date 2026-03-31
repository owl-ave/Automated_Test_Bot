import { Logger } from '../../utils/logger';

export interface NetworkChaosResult {
  test: string;
  passed: boolean;
  details: string;
  errorScreenshot?: string;
}

export class NetworkChaos {
  private logger = new Logger('NetworkChaos');

  async toggleAirplaneMode(driver: any, platform: string, enable: boolean): Promise<void> {
    try {
      if (platform.toLowerCase() === 'android') {
        if (enable) {
          await driver.execute('mobile: shell', {
            command: 'cmd',
            args: ['connectivity', 'airplane-mode', 'enable'],
          });
          await driver.execute('mobile: shell', {
            command: 'svc',
            args: ['wifi', 'disable'],
          });
          await driver.execute('mobile: shell', {
            command: 'svc',
            args: ['data', 'disable'],
          });
        } else {
          await driver.execute('mobile: shell', {
            command: 'cmd',
            args: ['connectivity', 'airplane-mode', 'disable'],
          });
          await driver.execute('mobile: shell', {
            command: 'svc',
            args: ['wifi', 'enable'],
          });
          await driver.execute('mobile: shell', {
            command: 'svc',
            args: ['data', 'enable'],
          });
        }
      } else {
        // iOS: Use BrowserStack's network throttling API
        const networkProfile = enable ? 'no-network' : 'reset';
        await driver.execute('browserstack_executor: setNetworkProfile', {
          profile: networkProfile,
        });
      }

      await driver.pause(2000);
      this.logger.log(`Airplane mode ${enable ? 'enabled' : 'disabled'} on ${platform}`);
    } catch (err) {
      this.logger.error(`Failed to toggle airplane mode on ${platform}`, err);
      throw err;
    }
  }

  async simulateSlowNetwork(driver: any): Promise<void> {
    try {
      // BrowserStack network throttling — 2G profile
      await driver.execute('browserstack_executor: setNetworkProfile', {
        profile: '2g-gprs-good',
      });

      this.logger.log('Slow network (2G) simulation enabled');
    } catch (err) {
      // Fallback: Appium network conditions
      try {
        await driver.setNetworkConditions({
          offline: false,
          latency: 500, // 500ms latency
          download_speed: 50 * 1024, // 50 KB/s
          upload_speed: 20 * 1024, // 20 KB/s
        });
        this.logger.log('Slow network simulation enabled via Appium');
      } catch (fallbackErr) {
        this.logger.error('Failed to simulate slow network', fallbackErr);
        throw fallbackErr;
      }
    }
  }

  async resetNetwork(driver: any): Promise<void> {
    try {
      await driver.execute('browserstack_executor: setNetworkProfile', {
        profile: 'reset',
      });
    } catch {
      try {
        await driver.setNetworkConditions({
          offline: false,
          latency: 0,
          download_speed: -1,
          upload_speed: -1,
        });
      } catch {
        /* best effort */
      }
    }
    this.logger.log('Network conditions reset');
  }

  async verifyOfflineBehavior(driver: any): Promise<NetworkChaosResult> {
    const result: NetworkChaosResult = {
      test: 'offline-behavior',
      passed: false,
      details: '',
    };

    try {
      // Get current screen state before going offline
      const beforeSource = await driver.getPageSource();

      // Enable airplane mode
      const platform = await this.detectPlatform(driver);
      await this.toggleAirplaneMode(driver, platform, true);
      await driver.pause(3000);

      // Check for proper error handling
      const afterSource = await driver.getPageSource();
      const screenshot = await driver.takeScreenshot().catch(() => null);
      result.errorScreenshot = screenshot;

      // Look for error indicators
      const hasErrorMessage = this.containsOfflineIndicator(afterSource);
      const hasCrashed = await this.checkForCrash(driver);

      if (hasCrashed) {
        result.details = 'App crashed when going offline';
        result.passed = false;
      } else if (hasErrorMessage) {
        result.details = 'App properly shows offline error/indicator';
        result.passed = true;
      } else {
        // Check if data is still displayed (cached data)
        const hasContent = afterSource.length > 500;
        if (hasContent) {
          result.details = 'App shows cached data while offline (acceptable)';
          result.passed = true;
        } else {
          result.details = 'App shows blank screen offline without error message';
          result.passed = false;
        }
      }

      // Restore network
      await this.toggleAirplaneMode(driver, platform, false);
      await driver.pause(2000);
    } catch (err) {
      result.details = `Offline behavior test error: ${err}`;
      // Attempt to restore network
      try {
        await this.resetNetwork(driver);
      } catch {
        /* best effort */
      }
    }

    this.logger.log('Offline behavior test complete', { passed: result.passed });
    return result;
  }

  async verifyReconnection(driver: any): Promise<NetworkChaosResult> {
    const result: NetworkChaosResult = {
      test: 'reconnection',
      passed: false,
      details: '',
    };

    try {
      const platform = await this.detectPlatform(driver);

      // Go offline
      await this.toggleAirplaneMode(driver, platform, true);
      await driver.pause(3000);

      // Perform an action that requires network (e.g., pull to refresh)
      try {
        const size = await driver.getWindowSize();
        await driver.touchAction([
          { action: 'press', x: size.width / 2, y: size.height * 0.3 },
          { action: 'wait', ms: 100 },
          { action: 'moveTo', x: size.width / 2, y: size.height * 0.7 },
          { action: 'release' },
        ]);
      } catch {
        /* swipe gesture optional */
      }

      await driver.pause(1000);

      // Reconnect
      await this.toggleAirplaneMode(driver, platform, false);
      await driver.pause(5000); // Give time for auto-retry

      // Check if app recovered
      const source = await driver.getPageSource();
      const hasCrashed = await this.checkForCrash(driver);

      if (hasCrashed) {
        result.details = 'App crashed after reconnection';
        result.passed = false;
      } else if (source.length > 500) {
        result.details = 'App recovered successfully after reconnection';
        result.passed = true;
      } else {
        result.details = 'App may not have auto-retried after reconnection';
        result.passed = false;
      }

      result.errorScreenshot = await driver.takeScreenshot().catch(() => undefined);
    } catch (err) {
      result.details = `Reconnection test error: ${err}`;
      try {
        await this.resetNetwork(driver);
      } catch {
        /* best effort */
      }
    }

    this.logger.log('Reconnection test complete', { passed: result.passed });
    return result;
  }

  private containsOfflineIndicator(pageSource: string): boolean {
    const indicators = [
      'no internet',
      'no connection',
      'offline',
      'network error',
      'unable to connect',
      'check your connection',
      'no network',
      'retry',
      'try again',
      'connection lost',
    ];
    const lower = pageSource.toLowerCase();
    return indicators.some((indicator) => lower.includes(indicator));
  }

  private async checkForCrash(driver: any): Promise<boolean> {
    try {
      await driver.getPageSource();
      return false;
    } catch {
      return true;
    }
  }

  private async detectPlatform(driver: any): Promise<string> {
    try {
      const caps = await driver.getSession();
      return caps.platformName?.toLowerCase() || 'android';
    } catch {
      return 'android';
    }
  }
}
