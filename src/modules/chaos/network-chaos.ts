import axios from 'axios';
import { Logger } from '../../utils/logger';
import { getBrowserStackConfig } from '../../config/browserstack';
import { swipeFromTo } from '../browserstack/w3c-actions';

export interface NetworkChaosResult {
  test: string;
  passed: boolean;
  details: string;
  errorScreenshot?: string;
}

// BrowserStack App Automate real network profile REST API.
// https://www.browserstack.com/docs/app-automate/appium/features/simulate-network-conditions
// PUT /app-automate/sessions/{sessionId}/update_network.json
async function setBrowserStackNetworkProfile(sessionId: string, profile: string): Promise<void> {
  const cfg = getBrowserStackConfig();
  const url = `https://api-cloud.browserstack.com/app-automate/sessions/${sessionId}/update_network.json`;
  await axios.put(
    url,
    { networkProfile: profile },
    {
      auth: { username: cfg.username, password: cfg.accessKey },
      timeout: cfg.timeout,
    },
  );
}

export class NetworkChaos {
  private logger = new Logger('NetworkChaos');

  async toggleAirplaneMode(driver: any, platform: string, enable: boolean): Promise<void> {
    if (platform.toLowerCase() === 'android') {
      try {
        if (enable) {
          await driver.execute('mobile: shell', { command: 'svc', args: ['wifi', 'disable'] });
          await driver.execute('mobile: shell', { command: 'svc', args: ['data', 'disable'] });
        } else {
          await driver.execute('mobile: shell', { command: 'svc', args: ['wifi', 'enable'] });
          await driver.execute('mobile: shell', { command: 'svc', args: ['data', 'enable'] });
        }
        await driver.pause(2000);
        this.logger.log(`Network ${enable ? 'disabled' : 'enabled'} on Android via adb`);
        return;
      } catch (err) {
        this.logger.warn('adb network toggle failed, falling back to BrowserStack profile', { error: String(err) });
      }
    }

    // iOS or Android-fallback: BrowserStack REST network profile.
    const profile = enable ? 'no-network' : 'reset';
    try {
      await setBrowserStackNetworkProfile(driver.sessionId, profile);
      await driver.pause(2000);
      this.logger.log(`BrowserStack network profile set to ${profile}`);
    } catch (err) {
      this.logger.error('Failed to set BrowserStack network profile', err);
      throw err;
    }
  }

  async simulateSlowNetwork(driver: any): Promise<void> {
    try {
      await setBrowserStackNetworkProfile(driver.sessionId, '2g-gprs-good');
      this.logger.log('Slow network (2G) simulation enabled via BrowserStack');
      return;
    } catch (err) {
      this.logger.warn('BrowserStack slow-network failed, trying Appium setNetworkConditions', {
        error: String(err),
      });
    }

    // Appium fallback (Android-only). Requires chromedriver-style network-conditions support; many
    // Appium versions expose this on Android emulators but not on real iOS devices.
    try {
      await driver.setNetworkConditions({
        offline: false,
        latency: 500,
        download_speed: 50 * 1024,
        upload_speed: 20 * 1024,
      });
      this.logger.log('Slow network simulation enabled via Appium setNetworkConditions');
    } catch (fallbackErr) {
      this.logger.error('Failed to simulate slow network', fallbackErr);
      throw fallbackErr;
    }
  }

  async resetNetwork(driver: any): Promise<void> {
    try {
      await setBrowserStackNetworkProfile(driver.sessionId, 'reset');
      this.logger.log('Network conditions reset via BrowserStack');
      return;
    } catch (err) {
      this.logger.warn('BrowserStack network reset failed, trying Appium', { error: String(err) });
    }
    try {
      await driver.setNetworkConditions({
        offline: false,
        latency: 0,
        download_speed: -1,
        upload_speed: -1,
      });
      this.logger.log('Network conditions reset via Appium');
    } catch (err) {
      this.logger.warn('Appium network reset also failed; leaving session as-is', { error: String(err) });
    }
  }

  async verifyOfflineBehavior(driver: any): Promise<NetworkChaosResult> {
    const result: NetworkChaosResult = {
      test: 'offline-behavior',
      passed: false,
      details: '',
    };

    try {
      await driver.getPageSource();
      const platform = await this.detectPlatform(driver);
      await this.toggleAirplaneMode(driver, platform, true);
      await driver.pause(3000);

      const afterSource = await driver.getPageSource();
      const screenshot = await driver.takeScreenshot().catch(() => undefined);
      result.errorScreenshot = screenshot;

      const hasErrorMessage = this.containsOfflineIndicator(afterSource);
      const hasCrashed = await this.checkForCrash(driver);

      if (hasCrashed) {
        result.details = 'App crashed when going offline';
        result.passed = false;
      } else if (hasErrorMessage) {
        result.details = 'App properly shows offline error/indicator';
        result.passed = true;
      } else {
        const hasContent = afterSource.length > 500;
        if (hasContent) {
          result.details = 'App shows cached data while offline (acceptable)';
          result.passed = true;
        } else {
          result.details = 'App shows blank screen offline without error message';
          result.passed = false;
        }
      }

      await this.toggleAirplaneMode(driver, platform, false);
      await driver.pause(2000);
    } catch (err) {
      result.details = `Offline behavior test error: ${err}`;
      await this.resetNetwork(driver).catch((e) =>
        this.logger.warn('network reset during error path failed', { error: String(e) }),
      );
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

      await this.toggleAirplaneMode(driver, platform, true);
      await driver.pause(3000);

      // Pull-to-refresh gesture while offline (expected to surface an error UI).
      try {
        const size = await driver.getWindowSize();
        const cx = Math.floor(size.width / 2);
        await swipeFromTo(driver, cx, Math.floor(size.height * 0.3), cx, Math.floor(size.height * 0.7), 250);
      } catch (err) {
        this.logger.debug('pull-to-refresh gesture failed (not fatal)', { error: String(err) });
      }

      await driver.pause(1000);

      await this.toggleAirplaneMode(driver, platform, false);
      await driver.pause(5000);

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
      await this.resetNetwork(driver).catch((e) =>
        this.logger.warn('network reset during error path failed', { error: String(e) }),
      );
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
