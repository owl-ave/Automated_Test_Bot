import { TestResult } from '../../types';
import { GitHubClient } from '../../utils/github';
import { Logger } from '../../utils/logger';

interface BlockReason {
  scenario: string;
  error: string;
  device: string;
}

export class MergeBlocker {
  private github: GitHubClient;
  private logger = new Logger('MergeBlocker');

  constructor(githubClient: GitHubClient) {
    this.github = githubClient;
  }

  shouldBlockMerge(testResults: TestResult[]): { blocked: boolean; reasons: BlockReason[] } {
    const failures = testResults.filter((r) => r.status === 'fail');

    if (failures.length === 0) {
      return { blocked: false, reasons: [] };
    }

    // Don't block if the only failures are on a single device (likely a flaky device issue)
    const failedDevices = [...new Set(failures.map((r) => r.device))];
    const totalDevices = [...new Set(testResults.map((r) => r.device))];
    if (failedDevices.length === 1 && totalDevices.length > 1) {
      const failedOnlyDevice = failedDevices[0];
      const passedOnSameDevice = testResults.filter((r) => r.device === failedOnlyDevice && r.status === 'pass');
      // If most tests pass on that device, it's likely a flaky scenario, not a real regression
      if (passedOnSameDevice.length > failures.length * 2) {
        return { blocked: false, reasons: [] };
      }
    }

    // Check failure rate — don't block if < 10% of tests fail (likely flaky)
    const failRate = failures.length / testResults.length;
    if (failRate < 0.1 && failures.length <= 2) {
      return { blocked: false, reasons: [] };
    }

    const reasons: BlockReason[] = failures.map((r) => ({
      scenario: r.scenario,
      error: r.error || 'Test failed',
      device: r.device,
    }));

    return { blocked: true, reasons };
  }

  async createCheckRun(
    owner: string,
    repo: string,
    sha: string,
    blocked: boolean,
    reasons?: BlockReason[],
  ): Promise<void> {
    const summary = blocked
      ? `Merge blocked: ${reasons?.length || 0} critical test failure(s)\n\n` +
        (reasons || []).map((r) => `- **${r.scenario}** (${r.device}): ${r.error}`).join('\n')
      : 'All critical tests passed. Safe to merge.';

    try {
      await this.github.createCheckRun(owner, repo, sha, 'Automated Testing Bot', blocked ? 'failure' : 'success', {
        title: blocked ? 'Tests Failed — Merge Blocked' : 'Tests Passed',
        summary,
      });
      this.logger.log('Check run created', { sha, blocked });
    } catch (err) {
      this.logger.error('Failed to create check run', err);
      throw err;
    }
  }
}
