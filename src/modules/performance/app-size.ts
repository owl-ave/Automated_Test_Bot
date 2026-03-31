import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../utils/logger';

export interface AppSizeReport {
  sizeMb: number;
  deltaMb: number;
  deltaPercent: number;
  status: 'ok' | 'increased';
}

export class AppSizeTracker {
  private logger = new Logger('AppSizeTracker');
  private sizeIncreaseThresholdPercent = 5;

  measureSize(appPath: string): number {
    try {
      const stat = fs.statSync(appPath);
      const sizeMb = stat.size / (1024 * 1024);
      this.logger.log('App size measured', { appPath: path.basename(appPath), sizeMb: sizeMb.toFixed(2) });
      return Math.round(sizeMb * 100) / 100;
    } catch (err) {
      this.logger.error('Failed to measure app size', err);
      return -1;
    }
  }

  compareWithBaseline(currentSize: number, baselineSize: number): AppSizeReport {
    if (currentSize < 0 || baselineSize <= 0) {
      return { sizeMb: currentSize, deltaMb: 0, deltaPercent: 0, status: 'ok' };
    }

    const deltaMb = Math.round((currentSize - baselineSize) * 100) / 100;
    const deltaPercent = Math.round((deltaMb / baselineSize) * 10000) / 100;
    const status = deltaPercent > this.sizeIncreaseThresholdPercent ? 'increased' : 'ok';

    if (status === 'increased') {
      this.logger.warn('App size increased significantly', { currentSize, baselineSize, deltaMb, deltaPercent });
    }

    return { sizeMb: currentSize, deltaMb, deltaPercent, status };
  }
}
