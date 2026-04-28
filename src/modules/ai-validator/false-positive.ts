import { TestResult, BddScenario } from '../../types';
import { TestExecutor } from '../browserstack/executor';
import { getMinimalDeviceSet } from '../browserstack/device-matrix';
import { Device } from '../../config/devices';
import { Logger } from '../../utils/logger';

const logger = new Logger('FalsePositiveDetector');

export interface VerificationResult {
  isRealBug: boolean;
  confidence: number;
  retryResults: TestResult[];
  crossDeviceResults: TestResult[];
  analysis: string;
}

export class FalsePositiveDetector {
  private executor: TestExecutor;
  private maxRetries: number;

  constructor(maxRetries: number = 5) {
    this.executor = new TestExecutor();
    this.maxRetries = maxRetries;
  }

  // Flaky requires actual variance on the same device — a mix of passes and fails.
  // 0% pass means the bug reproduces (not flaky, it's broken). 100% pass means the original
  // failure was a one-off. Only the [20%, 80%] band with >=1 of each outcome is real flaky.
  async verify(
    failedResult: TestResult,
    scenario: BddScenario,
    appUrl: string,
    originalDevice: Device,
  ): Promise<VerificationResult> {
    logger.log('Verifying potential false positive', {
      scenario: failedResult.scenario,
      device: failedResult.device,
      error: failedResult.error?.substring(0, 100),
    });

    const retryResults = await this.retryOnSameDevice(scenario, appUrl, originalDevice);
    const retryPasses = retryResults.filter((r) => r.status === 'pass').length;
    const retryFails = retryResults.filter((r) => r.status === 'fail').length;
    const retryPassRate = retryResults.length > 0 ? retryPasses / retryResults.length : 0;

    // Consistent pass across all retries → treat original as a transient one-off, not a bug.
    if (retryPassRate === 1) {
      logger.log('All retries passed — original failure was transient');
      return {
        isRealBug: false,
        confidence: 90,
        retryResults,
        crossDeviceResults: [],
        analysis: 'All retries passed on the same device. Original failure was a one-off (transient).',
      };
    }

    // Genuine flaky band: both outcomes appear on the SAME device within the retry window.
    if (retryPasses >= 1 && retryFails >= 1 && retryPassRate >= 0.2 && retryPassRate <= 0.8) {
      logger.log('Flaky retry pattern detected (variance on same device)', {
        retryPassRate,
        retryPasses,
        retryFails,
      });
      return {
        isRealBug: false,
        confidence: Math.round((1 - Math.abs(retryPassRate - 0.5) * 2) * 70 + 30),
        retryResults,
        crossDeviceResults: [],
        analysis: `${retryPasses}/${retryResults.length} retries passed. Mixed outcomes on the same device indicate flakiness (race/timing/network), not a deterministic bug.`,
      };
    }

    // Otherwise: retries consistently failed (retryPassRate near 0). Cross-verify on other devices.
    const crossDeviceResults = await this.crossDeviceVerify(scenario, appUrl, originalDevice);
    const crossDeviceFailRate =
      crossDeviceResults.filter((r) => r.status === 'fail').length / Math.max(crossDeviceResults.length, 1);

    const failsOnOtherDevices = crossDeviceFailRate > 0.5;

    if (failsOnOtherDevices) {
      return {
        isRealBug: true,
        confidence: 95,
        retryResults,
        crossDeviceResults,
        analysis: 'Bug reproduces consistently across retries and devices. High confidence this is a real bug.',
      };
    }

    return {
      isRealBug: true,
      confidence: 70,
      retryResults,
      crossDeviceResults,
      analysis: `Bug reproduces on ${originalDevice.name} (${retryFails}/${retryResults.length} retries failed) but not on other devices. Likely device-specific.`,
    };
  }

  private async retryOnSameDevice(scenario: BddScenario, appUrl: string, device: Device): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (let i = 0; i < this.maxRetries; i++) {
      logger.log(`Retry ${i + 1}/${this.maxRetries}`, { device: device.name });
      try {
        const retryResults = await this.executor.executeTests(appUrl, [scenario], [device]);
        results.push(...retryResults);
      } catch (error) {
        logger.error(`Retry ${i + 1} failed`, error);
        results.push({
          scenario: scenario.scenario,
          status: 'fail',
          device: device.name,
          duration: 0,
          error: `Retry error: ${String(error)}`,
        });
      }
    }

    return results;
  }

  private async crossDeviceVerify(scenario: BddScenario, appUrl: string, excludeDevice: Device): Promise<TestResult[]> {
    const devices = getMinimalDeviceSet().filter((d) => d.name !== excludeDevice.name);
    if (devices.length === 0) return [];

    logger.log('Cross-device verification', { devices: devices.map((d) => d.name) });

    try {
      return await this.executor.executeTests(appUrl, [scenario], devices);
    } catch (error) {
      logger.error('Cross-device verification failed', error);
      return [];
    }
  }
}
