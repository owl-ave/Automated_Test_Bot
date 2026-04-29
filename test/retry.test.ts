import { runWithRetry } from '../src/utils/retry';
import { MaestroBuildTimeoutError } from '../src/modules/browserstack/maestro-runner';
import { RetryConfig } from '../src/config/thresholds';

const fastConfig: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1,
  backoffMultiplier: 1,
  maxDelayMs: 1,
};

describe('runWithRetry', () => {
  it('returns the result on the first successful attempt', async () => {
    const fn = jest.fn().mockResolvedValue({ moduleName: 'M', status: 'success' });
    const result = await runWithRetry('M', fn, fastConfig);
    expect(result.status).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to maxRetries on generic failure', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('flaky'));
    const result = await runWithRetry('M', fn, fastConfig);
    expect(result.status).toBe('error');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries when the result has status=error', async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ moduleName: 'M', status: 'error', error: 'boom' })
      .mockResolvedValueOnce({ moduleName: 'M', status: 'success' });
    const result = await runWithRetry('M', fn, fastConfig);
    expect(result.status).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on MaestroBuildTimeoutError — surfaces it immediately', async () => {
    const fn = jest.fn().mockRejectedValue(new MaestroBuildTimeoutError('build-123', 65_000));
    const result = await runWithRetry('BrowserStack', fn, fastConfig);
    expect(result.status).toBe('error');
    expect(result.error).toContain('build-123');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry even when a later attempt could succeed (timeout means orphaned build)', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new MaestroBuildTimeoutError('build-x', 1000))
      .mockResolvedValueOnce({ moduleName: 'M', status: 'success' });
    const result = await runWithRetry('BrowserStack', fn, fastConfig);
    expect(result.status).toBe('error');
    expect(fn).toHaveBeenCalledTimes(1); // never retries past the timeout
  });
});
