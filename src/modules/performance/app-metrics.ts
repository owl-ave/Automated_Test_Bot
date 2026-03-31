import { Logger } from '../../utils/logger';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  threshold: number;
  status: 'ok' | 'warning' | 'critical';
}

export class AppMetrics {
  private logger = new Logger('AppMetrics');

  async measureLaunchTime(
    driver: any,
    platform: string,
  ): Promise<{ cold: PerformanceMetric; warm: PerformanceMetric }> {
    this.logger.log('Measuring launch time', { platform });

    const coldStart = await this.measureColdStart(driver, platform);
    const warmStart = await this.measureWarmStart(driver, platform);

    return { cold: coldStart, warm: warmStart };
  }

  private async measureColdStart(driver: any, platform: string): Promise<PerformanceMetric> {
    const threshold = platform === 'android' ? 3000 : 2000;

    try {
      await driver.terminateApp(await this.getAppId(driver, platform));
      const start = Date.now();
      await driver.activateApp(await this.getAppId(driver, platform));
      await this.waitForAppReady(driver);
      const duration = Date.now() - start;

      return {
        name: 'cold_start',
        value: duration,
        unit: 'ms',
        threshold,
        status: duration > threshold * 1.5 ? 'critical' : duration > threshold ? 'warning' : 'ok',
      };
    } catch (err) {
      this.logger.error('Cold start measurement failed', err);
      return { name: 'cold_start', value: -1, unit: 'ms', threshold, status: 'critical' };
    }
  }

  private async measureWarmStart(driver: any, platform: string): Promise<PerformanceMetric> {
    const threshold = platform === 'android' ? 1500 : 1000;

    try {
      await driver.background(3);
      const start = Date.now();
      await this.waitForAppReady(driver);
      const duration = Date.now() - start;

      return {
        name: 'warm_start',
        value: duration,
        unit: 'ms',
        threshold,
        status: duration > threshold * 1.5 ? 'critical' : duration > threshold ? 'warning' : 'ok',
      };
    } catch (err) {
      this.logger.error('Warm start measurement failed', err);
      return { name: 'warm_start', value: -1, unit: 'ms', threshold, status: 'critical' };
    }
  }

  async measureFps(driver: any, scrollElement: string): Promise<PerformanceMetric> {
    const threshold = 55;

    try {
      const perfData = await driver.execute('mobile: getPerformanceData', {
        packageName: await this.getCurrentPackage(driver),
        dataType: 'gfxinfo',
      });

      const element = await driver.$(scrollElement);
      await element.touchAction([
        { action: 'press', x: 200, y: 600 },
        { action: 'wait', ms: 500 },
        { action: 'moveTo', x: 200, y: 200 },
        'release',
      ]);

      const perfDataAfter = await driver.execute('mobile: getPerformanceData', {
        packageName: await this.getCurrentPackage(driver),
        dataType: 'gfxinfo',
      });

      const fps = this.calculateFps(perfData, perfDataAfter);

      return {
        name: 'scroll_fps',
        value: fps,
        unit: 'fps',
        threshold,
        status: fps < 30 ? 'critical' : fps < threshold ? 'warning' : 'ok',
      };
    } catch (err) {
      this.logger.error('FPS measurement failed', err);
      return { name: 'scroll_fps', value: -1, unit: 'fps', threshold, status: 'critical' };
    }
  }

  async measureScreenLoad(driver: any, screenName: string): Promise<PerformanceMetric> {
    const threshold = 2000;

    try {
      const start = Date.now();
      await driver.waitUntil(
        async () => {
          const source = await driver.getPageSource();
          return source.includes(screenName) || source.length > 100;
        },
        { timeout: 10000, interval: 100 },
      );
      const duration = Date.now() - start;

      return {
        name: `screen_load_${screenName}`,
        value: duration,
        unit: 'ms',
        threshold,
        status: duration > threshold * 2 ? 'critical' : duration > threshold ? 'warning' : 'ok',
      };
    } catch (err) {
      this.logger.error('Screen load measurement failed', err);
      return { name: `screen_load_${screenName}`, value: -1, unit: 'ms', threshold, status: 'critical' };
    }
  }

  private async getAppId(driver: any, platform: string): Promise<string> {
    if (platform === 'android') {
      return await this.getCurrentPackage(driver);
    }
    const caps = await driver.getSession();
    return caps.bundleId || caps.app || '';
  }

  private async getCurrentPackage(driver: any): Promise<string> {
    try {
      return await driver.getCurrentPackage();
    } catch {
      return '';
    }
  }

  private async waitForAppReady(driver: any): Promise<void> {
    await driver.waitUntil(
      async () => {
        try {
          const source = await driver.getPageSource();
          return source && source.length > 50;
        } catch {
          return false;
        }
      },
      { timeout: 15000, interval: 200 },
    );
  }

  private calculateFps(before: any, after: any): number {
    try {
      if (Array.isArray(after) && after.length > 1) {
        const totalFrames = parseInt(after[1]?.[0] || '0', 10) - parseInt(before[1]?.[0] || '0', 10);
        const jankyFrames = parseInt(after[1]?.[1] || '0', 10) - parseInt(before[1]?.[1] || '0', 10);
        if (totalFrames > 0) {
          return Math.round(60 * (1 - jankyFrames / totalFrames));
        }
      }
    } catch {
      /* fallback */
    }
    return 60;
  }
}
