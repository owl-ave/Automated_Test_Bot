import * as dotenv from 'dotenv';
import { PipelineContext, ModuleResult } from './types';
import { runCodeReader } from './modules/code-reader';
import { Logger } from './utils/logger';
import { getThresholds, RetryConfig } from './config/thresholds';

dotenv.config();

const logger = new Logger('Pipeline');
const retryConfig = getThresholds().retry;

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  process.exit(1);
});

// Removes base64 screenshot blobs from log data to keep logs readable
function stripScreenshots(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(stripScreenshots);
  const obj = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = k === 'screenshot' && typeof v === 'string' ? `[screenshot: ${Math.round(v.length / 1024)}KB]` : stripScreenshots(v);
  }
  return result;
}

// --- Orchestrator Resilience Utilities --- //

async function runWithRetry(
  moduleName: string,
  fn: () => Promise<ModuleResult>,
  config: RetryConfig = retryConfig,
): Promise<ModuleResult> {
  let delayMs = config.initialDelayMs;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();
      if (result.status === 'error') {
        throw new Error(result.error || 'Unknown error');
      }
      return result;
    } catch (error) {
      if (attempt === config.maxRetries) {
        logger.error(`[${moduleName}] Failed after ${config.maxRetries} attempts`, error);
        return { moduleName, status: 'error', error: String(error) };
      }
      logger.warn(`[${moduleName}] Attempt ${attempt} failed, retrying in ${delayMs}ms...`, error);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * config.backoffMultiplier, config.maxDelayMs);
    }
  }
  return { moduleName, status: 'error', error: 'Exceeded retries' };
}

/**
 * Executes a pipeline step. If isCritical is true, a failure aborts the entire pipeline.
 */
async function executeStep(
  context: PipelineContext,
  moduleName: string,
  executable: () => Promise<ModuleResult>,
  isCritical: boolean = false,
  useRetry: boolean = false,
): Promise<boolean> {
  logger.log(`---> Starting ${moduleName}...`);
  const startTime = Date.now();

  const result: ModuleResult = useRetry ? await runWithRetry(moduleName, executable) : await executable();
  const durationMs = Date.now() - startTime;

  context.logs.push(`${moduleName} [${durationMs}ms]: ${result.status}`);

  if (result.status === 'success' || result.status === 'warning' || result.status === 'skipped') {
    context.moduleStatuses.push({ name: moduleName, status: result.status, durationMs, error: result.error });
    logger.log(`${moduleName} completed safely`, stripScreenshots(result.data) || `${result.status} without data`);
    return true;
  }

  context.moduleStatuses.push({ name: moduleName, status: 'error', durationMs, error: result.error });
  logger.error(`${moduleName} failed`, result.error);
  if (isCritical) {
    logger.error(`CRITICAL FAILURE in ${moduleName}. Aborting pipeline to prevent invalid state.`);
    throw new Error(`Critical pipeline step failed: ${moduleName}`);
  } else {
    logger.warn(`Non-critical step ${moduleName} failed. Continuing pipeline.`);
    return false;
  }
}

// --- Main Execution State Machine --- //

async function main(): Promise<void> {
  const prNumber = parseInt(process.argv[2] || '0', 10);

  if (!prNumber) {
    logger.error('PR number required: npm run start -- <pr_number>');
    process.exit(1);
  }

  // TARGET_REPO = the repo being tested (e.g. owl-ave/Nola), set by workflow
  // GITHUB_REPOSITORY = fallback (the bot's own repo)
  const targetRepo = process.env.TARGET_REPO || process.env.GITHUB_REPOSITORY || '';
  const repoOwner = targetRepo.split('/')[0] || '';
  const repoName = targetRepo.split('/')[1] || '';
  let branch = process.env.TARGET_BRANCH || process.env.GITHUB_HEAD_REF || '';

  // Fetch PR branch from GitHub if not explicitly set
  if (!branch && prNumber > 0 && repoOwner && repoName) {
    try {
      const { GitHubClient } = await import('./utils/github');
      const gh = new GitHubClient();
      const pr = await gh.getPR(repoOwner, repoName, prNumber);
      branch = pr.head.ref || 'main';
      logger.log('Fetched PR branch from GitHub', { branch });
    } catch {
      branch = 'main';
    }
  }
  if (!branch) branch = 'main';

  // TARGET_PATH = where the target repo is checked out (set by workflow)
  const targetPath = process.env.TARGET_PATH || process.cwd();

  const context: PipelineContext = {
    prNumber,
    repoOwner,
    repoName,
    branch,
    targetPath,
    diffFiles: [],
    logs: [],
    moduleStatuses: [],
  };

  // Validate required environment variables early
  const missingVars: string[] = [];
  const requiredVars = ['CLAUDE_CODE_OAUTH_TOKEN'];
  const requiredIfNotLocal = ['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY'];
  const requiredGitHub = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY'];

  for (const v of requiredVars) {
    if (!process.env[v]) missingVars.push(v);
  }

  const localMode = process.env.LOCAL_MODE === 'true';

  if (!localMode) {
    for (const v of requiredIfNotLocal) {
      if (!process.env[v]) missingVars.push(v);
    }
  }

  // GitHub auth: need either GITHUB_TOKEN or GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY
  if (!process.env.GITHUB_TOKEN && !process.env.GITHUB_APP_ID) {
    missingVars.push('GITHUB_TOKEN or GITHUB_APP_ID');
  }

  if (missingVars.length > 0) {
    logger.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    logger.error('Set these in .env or as GitHub Action secrets before running the pipeline.');
    process.exit(1);
  }

  logger.log('Pipeline orchestrator starting in hardened mode.', { pr: prNumber, branch: context.branch });

  try {
    // 1. Code Reader (Critical) — must run first to detect framework & mobilePath
    await executeStep(context, 'CodeReader', () => runCodeReader(context), true);

    // 0. App Builder (skip in local mode — needs Android SDK / Xcode)
    if (!localMode) {
      const { runAppBuilder } = await import('./modules/app-builder');
      await executeStep(context, 'AppBuilder', () => runAppBuilder(context), false);
    } else {
      logger.log('LOCAL_MODE: Skipping AppBuilder (no build tools needed)');
      context.moduleStatuses.push({ name: 'AppBuilder', status: 'skipped', durationMs: 0, error: 'LOCAL_MODE enabled — no build tools available' });
    }

    // 2. App Analyzer (Critical)
    const { runAppAnalyzer } = await import('./modules/app-analyzer');
    await executeStep(context, 'AppAnalyzer', () => runAppAnalyzer(context), true);

    // 3. Scenario Brain (Critical, uses Retry for AI network calls)
    const { runScenarioBrain } = await import('./modules/scenario-brain');
    await executeStep(context, 'ScenarioBrain', () => runScenarioBrain(context), true, true);

    // 4. Test Writer (Critical)
    const { runTestWriter } = await import('./modules/test-writer');
    await executeStep(context, 'TestWriter', () => runTestWriter(context), true);

    // 5. BrowserStack Execution (skip if no app build, retry if flaky)
    const { runBrowserStack } = await import('./modules/browserstack');
    if (context.appBuild?.androidAppUrl || context.appBuild?.iosAppUrl) {
      await executeStep(context, 'BrowserStack', () => runBrowserStack(context), true, true);
    } else {
      const reason = 'No app build available — AppBuilder either failed or was skipped, so real device testing could not run';
      logger.warn(`Skipping BrowserStack — ${reason}`);
      context.logs.push('BrowserStack: skipped (no app URLs)');
      context.moduleStatuses.push({ name: 'BrowserStack', status: 'skipped', durationMs: 0, error: reason });
    }

    // 6. AI Validator (Non-critical, uses Retry)
    const { runAiValidator } = await import('./modules/ai-validator');
    await executeStep(context, 'AiValidator', () => runAiValidator(context), false, true);

    // 7. Self-Healer (Non-critical)
    const { runSelfHealer } = await import('./modules/self-healer');
    await executeStep(context, 'SelfHealer', () => runSelfHealer(context), false);

    // 9. Accessibility Testing (Non-critical)
    const { runAccessibility } = await import('./modules/accessibility');
    await executeStep(context, 'Accessibility', () => runAccessibility(context), false);

    // 10. Performance Testing (Non-critical)
    const { runPerformance } = await import('./modules/performance');
    await executeStep(context, 'Performance', () => runPerformance(context), false);

    // 11. API Tester (Non-critical, uses Retry)
    const { runApiTester } = await import('./modules/api-tester');
    await executeStep(context, 'ApiTester', () => runApiTester(context), false, true);

    // 12. Security Testing (Non-critical)
    const { runSecurity } = await import('./modules/security');
    await executeStep(context, 'Security', () => runSecurity(context), false);

    // 13. Visual Regression (Non-critical)
    const { runVisualRegression } = await import('./modules/visual-regression');
    await executeStep(context, 'VisualRegression', () => runVisualRegression(context), false);

    // 14. Chaos Testing (Non-critical)
    const { runChaos } = await import('./modules/chaos');
    await executeStep(context, 'Chaos', () => runChaos(context), false);

    // 15. Test Prioritizer (Non-critical)
    const { runPrioritizer } = await import('./modules/prioritizer');
    await executeStep(context, 'Prioritizer', () => runPrioritizer(context), false);

    // 16. Knowledge Base (Non-critical)
    const { runKnowledgeBase } = await import('./modules/knowledge-base');
    await executeStep(context, 'KnowledgeBase', () => runKnowledgeBase(context), false);

    // 8. PR Reporter (Critical - always runs last to report all collected data)
    const { runReporter } = await import('./modules/reporter');
    await executeStep(context, 'Reporter', () => runReporter(context), true, true);

    logger.log('Pipeline execution totally complete. All modules executed robustly.', {
      pr: prNumber,
      results: context.logs.length,
    });
  } catch (error) {
    logger.error('Pipeline failed fatally midway.', error);
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error('Pipeline crashed', err);
  process.exit(1);
});
