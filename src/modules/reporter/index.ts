import * as fs from 'fs';
import * as path from 'path';
import { PipelineContext, ModuleResult } from '../../types';
import { GitHubClient } from '../../utils/github';
import { Logger } from '../../utils/logger';
import { PrCommenter } from './pr-commenter';
import { LabelManager } from './label-manager';
import { MergeBlocker } from './merge-blocker';

export async function runReporter(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('Reporter');
  logger.log('Starting reporter module', { prNumber: context.prNumber });

  const github = new GitHubClient();
  const results = context.testResults || [];
  let blocked = false;

  try {
    // Post PR comment (critical)
    const commenter = new PrCommenter(github);
    const report = commenter.generateReport(context);

    // Write summary to test-results/summary.md for GitHub Action artifact (async).
    const resultsDir = path.resolve('test-results');
    await fs.promises.mkdir(resultsDir, { recursive: true });
    await fs.promises.writeFile(path.join(resultsDir, 'summary.md'), report, 'utf-8');
    logger.log('Test results summary written to test-results/summary.md');

    // The PR comment is critical, but labels + check-run are independent side-effects and
    // safe to parallelize with the comment post. Use allSettled so a failure in any one
    // surfaces as a non-fatal warning without taking the others down.
    const labelManager = new LabelManager(github);
    const mergeBlocker = new MergeBlocker(github);

    const commentTask = commenter.postReport(context.repoOwner, context.repoName, context.prNumber, report);

    const labelTask = labelManager
      .updateLabels(context.repoOwner, context.repoName, context.prNumber, results, {
        framework: context.codeAnalysis?.framework,
      })
      .catch((err) => {
        logger.warn('Label update failed (non-fatal)', err);
      });

    const checkRunTask = (async () => {
      try {
        const pr = await github.getPR(context.repoOwner, context.repoName, context.prNumber);
        const result = mergeBlocker.shouldBlockMerge(results);
        blocked = result.blocked;
        await mergeBlocker.createCheckRun(
          context.repoOwner,
          context.repoName,
          pr.head.sha,
          blocked,
          result.reasons,
        );
      } catch (err) {
        logger.warn('Check run creation failed (non-fatal — PAT may lack checks:write scope)', err);
      }
    })();

    const [commentOutcome] = await Promise.allSettled([commentTask, labelTask, checkRunTask]);
    if (commentOutcome.status === 'rejected') throw commentOutcome.reason;

    logger.log('Reporter module completed', { blocked });

    return {
      moduleName: 'reporter',
      status: 'success',
      data: { reportPosted: true, blocked, failedCount: results.filter((r) => r.status === 'fail').length },
    };
  } catch (err) {
    logger.error('Reporter module failed', err);
    return { moduleName: 'reporter', status: 'error', error: String(err) };
  }
}
