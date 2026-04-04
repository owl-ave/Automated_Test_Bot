import { TestResult } from '../../types';
import { GitHubClient } from '../../utils/github';
import { Logger } from '../../utils/logger';

const MANAGED_LABELS = [
  'tests-passed',
  'tests-failed',
  'tests-warning',
  'android-tests-failed',
  'ios-tests-failed',
  'accessibility-issues',
  'performance-regression',
  'framework:react-native',
  'framework:flutter',
  'framework:swift',
  'framework:kotlin',
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
    extra?: { accessibilityIssues?: boolean; performanceRegression?: boolean; framework?: string },
  ): Promise<string[]> {
    const labelsToAdd = this.determineLabels(testResults, extra);

    if (labelsToAdd.length === 0) {
      this.logger.log('No labels to add, skipping');
      return labelsToAdd;
    }

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
    extra?: { accessibilityIssues?: boolean; performanceRegression?: boolean; framework?: string },
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

    // Platform-specific failure labels
    const androidFails = results.filter((r) => r.status === 'fail' && r.device.toLowerCase().match(/pixel|samsung|oneplus|galaxy|android/));
    const iosFails = results.filter((r) => r.status === 'fail' && r.device.toLowerCase().match(/iphone|ipad|ios/));
    if (androidFails.length > 0) labels.push('android-tests-failed');
    if (iosFails.length > 0) labels.push('ios-tests-failed');

    // Framework label
    const fw = extra?.framework;
    if (fw === 'react-native') labels.push('framework:react-native');
    else if (fw === 'flutter') labels.push('framework:flutter');
    else if (fw === 'swift') labels.push('framework:swift');
    else if (fw === 'kotlin') labels.push('framework:kotlin');

    if (extra?.accessibilityIssues) {
      labels.push('accessibility-issues');
    }
    if (extra?.performanceRegression) {
      labels.push('performance-regression');
    }

    return labels;
  }
}
