import * as fs from 'fs';
import * as path from 'path';
import { PipelineContext, ModuleResult } from '../../types';
import { Logger } from '../../utils/logger';
import { TestRunStorage, TestRunRecord } from './storage';
import { VectorSearch } from './vector-search';
import { FlakyDetector } from './flaky-detector';
import { FeedbackLoop } from './feedback-loop';

export { TestRunStorage, TestRunRecord } from './storage';
export { VectorSearch } from './vector-search';
export { FlakyDetector } from './flaky-detector';
export { FeedbackLoop } from './feedback-loop';

async function saveToJsonFile(context: PipelineContext, logger: Logger): Promise<ModuleResult> {
  try {
    const testResults = context.testResults ?? [];
    const storageDir = path.resolve('test-results');
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

    const filePath = path.join(storageDir, 'knowledge-base.json');
    const existing = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      : { runs: [] };

    const newRuns = testResults.map((r) => ({
      prNumber: context.prNumber,
      scenario: r.scenario,
      device: r.device,
      status: r.status,
      duration: r.duration,
      failureReason: r.error,
      timestamp: new Date().toISOString(),
    }));

    existing.runs.push(...newRuns);
    // Keep last 500 runs to avoid unbounded growth
    if (existing.runs.length > 500) existing.runs = existing.runs.slice(-500);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');

    logger.log('Knowledge base saved to local JSON file', { path: filePath, savedRuns: newRuns.length });
    return {
      moduleName: 'knowledge-base',
      status: 'success',
      data: { savedRuns: newRuns.length, storage: 'file', path: filePath },
    };
  } catch (err) {
    logger.error('JSON file fallback failed', err);
    return { moduleName: 'knowledge-base', status: 'error', error: String(err) };
  }
}

export async function runKnowledgeBase(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('KnowledgeBase');
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    logger.warn('DATABASE_URL not set — falling back to local JSON file storage');
    return saveToJsonFile(context, logger);
  }

  const storage = new TestRunStorage(databaseUrl);
  const vectorSearch = new VectorSearch(databaseUrl);
  const flakyDetector = new FlakyDetector();
  const feedbackLoop = new FeedbackLoop(databaseUrl);

  try {
    // Store current test results
    const testResults = context.testResults ?? [];
    const savedIds: string[] = [];

    for (const result of testResults) {
      const record: TestRunRecord = {
        prNumber: context.prNumber,
        scenario: result.scenario,
        device: result.device,
        platform:
          result.device.toLowerCase().includes('iphone') || result.device.toLowerCase().includes('ipad')
            ? 'ios'
            : 'android',
        status: result.status,
        duration: result.duration,
        failureReason: result.error,
        selfHealed: false,
        timestamp: new Date().toISOString(),
      };

      try {
        const id = await storage.saveTestRun(record);
        savedIds.push(id);
      } catch (err) {
        logger.error(`Failed to save test run for "${result.scenario}"`, err);
      }
    }

    // Index failures for vector similarity search
    const failures = testResults.filter((r) => r.status === 'fail' && r.error);
    for (const failure of failures) {
      try {
        const embedding = vectorSearch.generateEmbedding(`${failure.scenario} ${failure.error}`);
        await vectorSearch.indexFailure({
          scenario: failure.scenario,
          error: failure.error!,
          embedding,
        });
      } catch (err) {
        logger.debug('Vector indexing skipped (pgvector may not be available)', err);
      }
    }

    // Detect flaky tests
    const flakyTests: Array<{ scenario: string; flakinessScore: number }> = [];
    const uniqueScenarios = [...new Set(testResults.map((r) => r.scenario))];

    for (const scenario of uniqueScenarios) {
      try {
        const history = await storage.getTestRuns({ scenario });
        const result = flakyDetector.detect(scenario, history);
        if (result.isFlaky) {
          flakyTests.push({ scenario, flakinessScore: result.flakinessScore });
          if (flakyDetector.shouldQuarantine(result.flakinessScore)) {
            flakyDetector.quarantine(scenario);
          }
        }
      } catch (err) {
        logger.debug(`Flaky detection skipped for "${scenario}"`, err);
      }
    }

    logger.log('Knowledge base updated', {
      savedRuns: savedIds.length,
      indexedFailures: failures.length,
      flakyTests: flakyTests.length,
    });

    return {
      moduleName: 'knowledge-base',
      status: 'success',
      data: {
        savedRuns: savedIds.length,
        indexedFailures: failures.length,
        flakyTests,
        quarantined: flakyDetector.getQuarantinedScenarios(),
      },
    };
  } catch (err) {
    logger.error('Knowledge base module failed', err);
    return { moduleName: 'knowledge-base', status: 'error', error: String(err) };
  } finally {
    await storage.close().catch(() => {});
    await vectorSearch.close().catch(() => {});
    await feedbackLoop.close().catch(() => {});
  }
}
