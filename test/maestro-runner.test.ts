import { computePollTimeoutMs, MaestroBuildTimeoutError } from '../src/modules/browserstack/maestro-runner';
import { MaestroPollConfig } from '../src/config/thresholds';

const baseCfg: MaestroPollConfig = {
  minTimeoutMs: 20 * 60_000,
  perFlowBudgetMs: 120_000,
  deviceAcquisitionBufferMs: 5 * 60_000,
  intervalMs: 5_000,
  progressLogIntervalMs: 60_000,
};

describe('computePollTimeoutMs', () => {
  it('uses the floor for very small flow counts', () => {
    // 1 flow * 2 min = 2 min, well under 20-min floor → falls back to floor + buffer
    expect(computePollTimeoutMs(1, baseCfg)).toBe(20 * 60_000 + 5 * 60_000);
    expect(computePollTimeoutMs(5, baseCfg)).toBe(20 * 60_000 + 5 * 60_000);
  });

  it('scales with flow count once past the floor', () => {
    // 28 flows × 2 min = 56 min (exceeds 20 min floor) → 56 + 5 = 61 min
    expect(computePollTimeoutMs(28, baseCfg)).toBe(56 * 60_000 + 5 * 60_000);
    // 50 flows × 2 min = 100 min → 100 + 5 = 105 min
    expect(computePollTimeoutMs(50, baseCfg)).toBe(100 * 60_000 + 5 * 60_000);
  });

  it('always adds the device acquisition buffer', () => {
    const cfg = { ...baseCfg, deviceAcquisitionBufferMs: 7 * 60_000 };
    expect(computePollTimeoutMs(1, cfg)).toBe(20 * 60_000 + 7 * 60_000);
    expect(computePollTimeoutMs(30, cfg)).toBe(60 * 60_000 + 7 * 60_000);
  });
});

describe('MaestroBuildTimeoutError', () => {
  it('preserves buildId and elapsedMs for diagnostics', () => {
    const err = new MaestroBuildTimeoutError('abc123', 65_000);
    expect(err.buildId).toBe('abc123');
    expect(err.elapsedMs).toBe(65_000);
    expect(err.name).toBe('MaestroBuildTimeoutError');
    expect(err.message).toContain('abc123');
    expect(err.message).toContain('65s');
  });

  it('is recognizable as an Error and via instanceof', () => {
    const err = new MaestroBuildTimeoutError('x', 1000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MaestroBuildTimeoutError);
  });
});
