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

  constructor(maxRetries: number = 2) {
    this.executor = new TestExecutor();
    this.maxRetries = maxRetries;
  }

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

    // Step 1: Retry on same device
    const retryResults = await this.retryOnSameDevice(scenario, appUrl, originalDevice);
    const retryPassRate = retryResults.filter((r) => r.status === 'pass').length / retryResults.length;

    // If retries consistently pass, likely a flaky failure
    if (retryPassRate >= 0.5) {
      logger.log('Retries mostly passed — likely flaky', { retryPassRate });
      return {
        isRealBug: false,
        confidence: Math.round(retryPassRate * 100),
        retryResults,
        crossDeviceResults: [],
        analysis: `${Math.round(retryPassRate * 100)}% of retries passed. Original failure likely flaky (timing, network, etc.)`,
      };
    }

    // Step 2: Cross-device verification
    const crossDeviceResults = await this.crossDeviceVerify(scenario, appUrl, originalDevice);
    const crossDeviceFailRate =
      crossDeviceResults.filter((r) => r.status === 'fail').length / Math.max(crossDeviceResults.length, 1);

    // Analyze combined results
    const allRetryFailed = retryPassRate === 0;
    const failsOnOtherDevices = crossDeviceFailRate > 0.5;

    if (allRetryFailed && failsOnOtherDevices) {
      return {
        isRealBug: true,
        confidence: 95,
        retryResults,
        crossDeviceResults,
        analysis: 'Bug reproduces consistently across retries and devices. High confidence this is a real bug.',
      };
    }

    if (allRetryFailed && !failsOnOtherDevices) {
      return {
        isRealBug: true,
        confidence: 70,
        retryResults,
        crossDeviceResults,
        analysis: `Bug reproduces on ${originalDevice.name} but not on other devices. Likely a device-specific issue.`,
      };
    }

    // Intermittent failure
    return {
      isRealBug: false,
      confidence: 50,
      retryResults,
      crossDeviceResults,
      analysis: 'Intermittent failure pattern detected. May be a flaky test or race condition.',
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
