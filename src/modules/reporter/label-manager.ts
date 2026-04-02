import { TestResult } from '../../types';
import { GitHubClient } from '../../utils/github';
import { Logger } from '../../utils/logger';

const MANAGED_LABELS = [
  'tests-passed',
  'tests-failed',
  'tests-warning',
  'accessibility-issues',
  'performance-regression',
] as const;

type ManagedLabel = (typeof MANAGED_LABELS)[number];

export class LabelManager {
  private github: GitHubClient;
  private logger = new Logger('LabelManager');

  constructor(githubClient: GitHubClient) {
    this.github = githubClient;
  }

  async updateLabels(
    owner: string,
    repo: string,
    prNumber: number,
    testResults: TestResult[],
    extra?: { accessibilityIssues?: boolean; performanceRegression?: boolean },
  ): Promise<string[]> {
    const labelsToAdd = this.determineLabels(testResults, extra);

    try {
      // Ensure labels exist on the repo before adding to PR
      for (const label of labelsToAdd) {
        try {
          await this.github.createLabel(owner, repo, label);
        } catch {
          // Label already exists — ignore
        }
      }
      await this.github.addLabel(owner, repo, prNumber, labelsToAdd);
      this.logger.log('Labels updated', { prNumber, labels: labelsToAdd });
    } catch (err) {
      this.logger.error('Failed to update labels', err);
    }

    return labelsToAdd;
  }

  private determineLabels(
    results: TestResult[],
    extra?: { accessibilityIssues?: boolean; performanceRegression?: boolean },
  ): string[] {
    const labels: ManagedLabel[] = [];
    const hasFail = results.some((r) => r.status === 'fail');
    const hasWarn = results.some((r) => r.status === 'warn');

    if (hasFail) {
      labels.push('tests-failed');
    } else if (hasWarn) {
      labels.push('tests-warning');
    } else if (results.length > 0) {
      labels.push('tests-passed');
    }

    if (extra?.accessibilityIssues) {
      labels.push('accessibility-issues');
    }
    if (extra?.performanceRegression) {
      labels.push('performance-regression');
    }

    return labels;
  }
}
