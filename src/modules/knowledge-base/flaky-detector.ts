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

  detect(scenario: string, recentRuns: TestRunRecord[]): FlakyResult {
    if (recentRuns.length < MIN_RUNS_FOR_DETECTION) {
      return { isFlaky: false, flakinessScore: 0, affectedDevices: [] };
    }

    const hasPasses = recentRuns.some((r) => r.status === 'pass');
    const hasFailures = recentRuns.some((r) => r.status === 'fail');

    if (!hasPasses || !hasFailures) {
      return { isFlaky: false, flakinessScore: 0, affectedDevices: [] };
    }

    // Compute flakiness as the ratio of status transitions
    const transitions = this.countTransitions(recentRuns);
    const maxTransitions = recentRuns.length - 1;
    const flakinessScore = maxTransitions > 0 ? transitions / maxTransitions : 0;

    const affectedDevices = this.findAffectedDevices(recentRuns);
    const isFlaky = flakinessScore >= FLAKY_THRESHOLD;

    if (isFlaky) {
      this.logger.warn(`Flaky test detected: "${scenario}"`, {
        flakinessScore: Math.round(flakinessScore * 100) / 100,
        affectedDevices,
        runs: recentRuns.length,
      });
    }

    return {
      isFlaky,
      flakinessScore: Math.round(flakinessScore * 100) / 100,
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

  private findAffectedDevices(runs: TestRunRecord[]): string[] {
    const deviceResults = new Map<string, Set<string>>();

    for (const run of runs) {
      if (!deviceResults.has(run.device)) {
        deviceResults.set(run.device, new Set());
      }
      deviceResults.get(run.device)!.add(run.status);
    }

    // Devices that have both pass and fail are "affected"
    const affected: string[] = [];
    for (const [device, statuses] of deviceResults) {
      if (statuses.has('pass') && statuses.has('fail')) {
        affected.push(device);
      }
    }
    return affected;
  }
}
