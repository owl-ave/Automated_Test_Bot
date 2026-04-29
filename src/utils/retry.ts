import { ModuleResult } from '../types';
import { Logger } from './logger';
import { RetryConfig } from '../config/thresholds';
import { MaestroBuildTimeoutError } from '../modules/browserstack/maestro-runner';

const logger = new Logger('Pipeline');

export async function runWithRetry(
  moduleName: string,
  fn: () => Promise<ModuleResult>,
  config: RetryConfig,
): Promise<ModuleResult> {
  let delayMs = config.initialDelayMs;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();
      if (result.status === 'error') {
        throw new Error(result.error || 'Unknown error');
      }
      return result;
    } catch (error) {
      // A Maestro build timeout means an in-flight build is still running on
      // BrowserStack. Retrying would orphan it and trigger a fresh build,
      // burning quota without producing results. Surface the failure instead.
      if (error instanceof MaestroBuildTimeoutError) {
        logger.error(`[${moduleName}] Build timed out — not retrying (would orphan builds and burn quota)`, {
          buildId: error.buildId,
          elapsedSec: Math.round(error.elapsedMs / 1000),
        });
        return { moduleName, status: 'error', error: String(error) };
      }
      if (attempt === config.maxRetries) {
        logger.error(`[${moduleName}] Failed after ${config.maxRetries} attempts`, error);
        return { moduleName, status: 'error', error: String(error) };
      }
      logger.warn(`[${moduleName}] Attempt ${attempt} failed, retrying in ${delayMs}ms...`, error);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * config.backoffMultiplier, config.maxDelayMs);
    }
  }
  return { moduleName, status: 'error', error: 'Exceeded retries' };
}
