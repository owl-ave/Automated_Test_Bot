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
    const criticalFailures = testResults.filter((r) => r.status === 'fail');

    if (criticalFailures.length === 0) {
      return { blocked: false, reasons: [] };
    }

    const reasons: BlockReason[] = criticalFailures.map((r) => ({
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
