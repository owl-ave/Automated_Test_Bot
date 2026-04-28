import { Logger } from '../../utils/logger';
import { TestRunRecord } from './storage';

interface FlakyResult {
  isFlaky: boolean;
  flakinessScore: number;
  affectedDevices: string[];
}

const MIN_RUNS_FOR_DETECTION = 5;
const FLAKY_THRESHOLD = 0.2;
const QUARANTINE_THRESHOLD = 0.4;

export class FlakyDetector {
  private logger = new Logger('FlakyDetector');
  private quarantined = new Set<string>();

  // Flakiness must be measured per device. A test that always passes on iOS and always fails on
  // Android is NOT flaky — it's platform-specific. Computing transitions across all runs (mixed
  // devices) inflates the score because pass/fail alternates with device, not with time on the
  // same device. We require the SAME device to show both outcomes before calling it flaky.
  detect(scenario: string, recentRuns: TestRunRecord[]): FlakyResult {
    if (recentRuns.length < MIN_RUNS_FOR_DETECTION) {
      return { isFlaky: false, flakinessScore: 0, affectedDevices: [] };
    }

    const byDevice = new Map<string, TestRunRecord[]>();
    for (const run of recentRuns) {
      const list = byDevice.get(run.device) || [];
      list.push(run);
      byDevice.set(run.device, list);
    }

    let worstScore = 0;
    const affectedDevices: string[] = [];

    for (const [device, runs] of byDevice) {
      if (runs.length < 2) continue;
      const passes = runs.filter((r) => r.status === 'pass').length;
      const fails = runs.filter((r) => r.status === 'fail').length;
      if (passes === 0 || fails === 0) continue; // consistent on this device — not flaky

      const transitions = this.countTransitions(runs);
      const maxTransitions = runs.length - 1;
      const score = maxTransitions > 0 ? transitions / maxTransitions : 0;
      if (score >= FLAKY_THRESHOLD) {
        affectedDevices.push(device);
      }
      if (score > worstScore) worstScore = score;
    }

    const isFlaky = affectedDevices.length > 0;

    if (isFlaky) {
      this.logger.warn(`Flaky test detected: "${scenario}"`, {
        flakinessScore: Math.round(worstScore * 100) / 100,
        affectedDevices,
        runs: recentRuns.length,
      });
    }

    return {
      isFlaky,
      flakinessScore: Math.round(worstScore * 100) / 100,
      affectedDevices,
    };
  }

  quarantine(scenario: string): void {
    this.quarantined.add(scenario);
    this.logger.log(`Quarantined flaky test: "${scenario}"`);
  }

  isQuarantined(scenario: string): boolean {
    return this.quarantined.has(scenario);
  }

  shouldQuarantine(flakinessScore: number): boolean {
    return flakinessScore >= QUARANTINE_THRESHOLD;
  }

  getQuarantinedScenarios(): string[] {
    return Array.from(this.quarantined);
  }

  private countTransitions(runs: TestRunRecord[]): number {
    let transitions = 0;
    const sorted = [...runs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].status !== sorted[i - 1].status) {
        transitions++;
      }
    }
    return transitions;
  }

}
