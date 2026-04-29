import { TestResult, MaestroFlow } from '../../types';
import { Device } from '../../config/devices';
import { Logger } from '../../utils/logger';

// DEPRECATED. The original FalsePositiveDetector retried failed tests by
// invoking the Appium TestExecutor on the same and other devices. Maestro
// handles retries server-side via its own `retryWhenError` policy and our
// build trigger does not expose a per-flow re-run, so this module is now a
// no-op stub. Kept around purely for type compatibility — no caller hits it
// after the Maestro migration. Delete once all callers are gone.
const logger = new Logger('FalsePositiveDetector');

export interface VerificationResult {
  isRealBug: boolean;
  confidence: number;
  retryResults: TestResult[];
  crossDeviceResults: TestResult[];
  analysis: string;
}

export class FalsePositiveDetector {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_maxRetries: number = 5) {}

  async verify(
    failedResult: TestResult,
    flow: MaestroFlow,
    _appUrl: string,
    _originalDevice: Device,
  ): Promise<VerificationResult> {
    logger.warn('FalsePositiveDetector is dormant after Maestro migration — returning failure as-is', {
      scenario: flow.scenario,
    });
    return {
      isRealBug: true,
      confidence: 0,
      retryResults: [failedResult],
      crossDeviceResults: [],
      analysis: 'False-positive verification is disabled; Maestro retries handle flakiness server-side.',
    };
  }
}
