import { Logger } from '../../utils/logger';

export interface MemoryReport {
  currentMb: number;
  peakMb: number;
  leaked: boolean;
  leakMb: number;
  steps?: StepMemory[];
}

interface StepMemory {
  step: string;
  memoryMb: number;
  deltaMb: number;
}

export class MemoryChecker {
  private logger = new Logger('MemoryChecker');

  async getMemoryUsage(driver: any, platform: string): Promise<number> {
    try {
      if (platform === 'android') {
        const perfData = await driver.execute('mobile: getPerformanceData', {
          packageName: await driver.getCurrentPackage(),
          dataType: 'memoryinfo',
        });
        if (Array.isArray(perfData) && perfData.length > 1) {
          const totalPss = parseInt(perfData[1]?.[0] || '0', 10);
          return Math.round(totalPss / 1024); // KB to MB
        }
      }

      if (platform === 'ios') {
        const perfData = await driver.execute('mobile: performanceData', {
          timeout: 5,
        });
        if (perfData?.memory) {
          return Math.round(perfData.memory / (1024 * 1024));
        }
      }

      return -1;
    } catch (err) {
      this.logger.error('Failed to get memory usage', err);
      return -1;
    }
  }

  async detectMemoryLeak(
    driver: any,
    platform: string,
    flowSteps: Array<{ name: string; action: () => Promise<void> }>,
  ): Promise<MemoryReport> {
    const stepMemories: StepMemory[] = [];
    let peakMb = 0;
    const leakThresholdMb = 20;

    const baselineMemory = await this.getMemoryUsage(driver, platform);
    let previousMemory = baselineMemory;

    for (const step of flowSteps) {
      try {
        await step.action();
        await this.wait(1000); // let GC settle

        const currentMemory = await this.getMemoryUsage(driver, platform);
        const delta = currentMemory - previousMemory;

        stepMemories.push({
          step: step.name,
          memoryMb: currentMemory,
          deltaMb: delta,
        });

        if (currentMemory > peakMb) {
          peakMb = currentMemory;
        }
        previousMemory = currentMemory;
      } catch (err) {
        this.logger.error(`Memory check failed at step: ${step.name}`, err);
      }
    }

    const finalMemory = await this.getMemoryUsage(driver, platform);
    const leakMb = Math.max(0, finalMemory - baselineMemory);
    const leaked = leakMb > leakThresholdMb;

    if (leaked) {
      this.logger.warn('Memory leak detected', { leakMb, baselineMemory, finalMemory });
    }

    return {
      currentMb: finalMemory,
      peakMb: peakMb > 0 ? peakMb : finalMemory,
      leaked,
      leakMb,
      steps: stepMemories,
    };
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
