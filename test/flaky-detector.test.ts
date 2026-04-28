import { FlakyDetector } from '../src/modules/knowledge-base/flaky-detector';
import type { TestRunRecord } from '../src/modules/knowledge-base/storage';

describe('FlakyDetector', () => {
  const make = (
    status: 'pass' | 'fail',
    device: string,
    daysAgo: number,
  ): TestRunRecord => ({
    prNumber: 1,
    scenario: 'Checkout completes successfully',
    device,
    platform: device.toLowerCase().includes('iphone') ? 'ios' : 'android',
    status,
    duration: 1000,
    selfHealed: false,
    timestamp: new Date(Date.now() - daysAgo * 86400 * 1000).toISOString(),
  });

  it('requires at least MIN_RUNS_FOR_DETECTION runs before calling anything flaky', () => {
    const detector = new FlakyDetector();
    const runs: TestRunRecord[] = [make('pass', 'Pixel 8', 3), make('fail', 'Pixel 8', 2)];
    const result = detector.detect('Checkout completes successfully', runs);
    expect(result.isFlaky).toBe(false);
    expect(result.flakinessScore).toBe(0);
  });

  it('does NOT mark a test as flaky when it always passes on iOS and always fails on Android', () => {
    const detector = new FlakyDetector();
    // Platform-specific failure, NOT flakiness.
    const runs: TestRunRecord[] = [
      make('pass', 'iPhone 16 Pro', 5),
      make('pass', 'iPhone 16 Pro', 4),
      make('pass', 'iPhone 16 Pro', 3),
      make('fail', 'Pixel 8', 5),
      make('fail', 'Pixel 8', 4),
      make('fail', 'Pixel 8', 3),
    ];
    const result = detector.detect('Checkout completes successfully', runs);
    expect(result.isFlaky).toBe(false);
    expect(result.affectedDevices).toEqual([]);
  });

  it('marks a test as flaky when the SAME device shows mixed pass/fail over time', () => {
    const detector = new FlakyDetector();
    const runs: TestRunRecord[] = [
      make('pass', 'Pixel 8', 6),
      make('fail', 'Pixel 8', 5),
      make('pass', 'Pixel 8', 4),
      make('fail', 'Pixel 8', 3),
      make('pass', 'Pixel 8', 2),
    ];
    const result = detector.detect('Checkout completes successfully', runs);
    expect(result.isFlaky).toBe(true);
    expect(result.affectedDevices).toContain('Pixel 8');
    expect(result.flakinessScore).toBeGreaterThan(0.2);
  });

  it('reports which specific devices are flaky (not a cross-device average)', () => {
    const detector = new FlakyDetector();
    const runs: TestRunRecord[] = [
      // Pixel 8: flaky (alternating)
      make('pass', 'Pixel 8', 6),
      make('fail', 'Pixel 8', 5),
      make('pass', 'Pixel 8', 4),
      make('fail', 'Pixel 8', 3),
      // iPhone 16 Pro: consistently passes
      make('pass', 'iPhone 16 Pro', 6),
      make('pass', 'iPhone 16 Pro', 5),
      make('pass', 'iPhone 16 Pro', 4),
    ];
    const result = detector.detect('Checkout completes successfully', runs);
    expect(result.isFlaky).toBe(true);
    expect(result.affectedDevices).toEqual(['Pixel 8']);
    expect(result.affectedDevices).not.toContain('iPhone 16 Pro');
  });

  it('quarantine gating respects the threshold', () => {
    const detector = new FlakyDetector();
    expect(detector.shouldQuarantine(0.3)).toBe(false);
    expect(detector.shouldQuarantine(0.4)).toBe(true);
    expect(detector.shouldQuarantine(0.5)).toBe(true);
  });
});
