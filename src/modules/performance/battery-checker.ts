import { Logger } from '../../utils/logger';

export interface BatteryReport {
  drainPercent: number;
  drainPerHour: number;
  status: 'ok' | 'high';
}

export class BatteryChecker {
  private logger = new Logger('BatteryChecker');

  async estimateBatteryDrain(driver: any, platform: string, durationMs: number): Promise<BatteryReport> {
    const highDrainThreshold = 10; // percent per hour

    try {
      const startLevel = await this.getBatteryLevel(driver, platform);
      this.logger.log('Battery measurement started', { startLevel, durationMs });

      await new Promise((resolve) => setTimeout(resolve, durationMs));

      const endLevel = await this.getBatteryLevel(driver, platform);
      const drainPercent = Math.max(0, startLevel - endLevel);
      const durationHours = durationMs / (1000 * 60 * 60);
      const drainPerHour = durationHours > 0 ? drainPercent / durationHours : 0;

      const status = drainPerHour > highDrainThreshold ? 'high' : 'ok';

      this.logger.log('Battery measurement completed', { drainPercent, drainPerHour, status });

      return {
        drainPercent: Math.round(drainPercent * 100) / 100,
        drainPerHour: Math.round(drainPerHour * 100) / 100,
        status,
      };
    } catch (err) {
      this.logger.error('Battery drain estimation failed', err);
      return { drainPercent: -1, drainPerHour: -1, status: 'ok' };
    }
  }

  private async getBatteryLevel(driver: any, platform: string): Promise<number> {
    try {
      if (platform === 'android') {
        const batteryInfo = await driver.execute('mobile: batteryInfo', {});
        return (batteryInfo?.level ?? 0) * 100;
      }

      if (platform === 'ios') {
        const batteryInfo = await driver.execute('mobile: batteryInfo', {});
        return (batteryInfo?.level ?? 0) * 100;
      }

      return 0;
    } catch (err) {
      this.logger.error('Failed to get battery level', err);
      return 0;
    }
  }
}
