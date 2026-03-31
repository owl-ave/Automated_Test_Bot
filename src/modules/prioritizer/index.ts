import { PipelineContext, ModuleResult } from '../../types';
import { Logger } from '../../utils/logger';
import { RiskScorer, HistoricalTestRun } from './risk-scorer';
import { TestScheduler } from './scheduler';

export { RiskScorer, HistoricalTestRun } from './risk-scorer';
export { TestScheduler } from './scheduler';

export async function runPrioritizer(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('Prioritizer');

  try {
    const scenarios = context.scenariosBdd;
    if (!scenarios || scenarios.length === 0) {
      logger.warn('No scenarios to prioritize');
      return { moduleName: 'prioritizer', status: 'warning', data: { message: 'No scenarios provided' } };
    }

    const scorer = new RiskScorer();
    const scheduler = new TestScheduler({ failFast: true, platformSpecific: true });

    const scores = new Map<string, number>();
    for (const scenario of scenarios) {
      // Historical data would come from knowledge-base module in full pipeline
      const historicalData: HistoricalTestRun[] = [];
      const score = scorer.scoreTest(scenario, context.diffFiles, historicalData);
      scores.set(scenario.scenario, score);
    }

    const prioritized = scheduler.prioritize(scenarios, scores, context.diffFiles);

    logger.log(`Prioritized ${prioritized.length} scenarios`);

    return {
      moduleName: 'prioritizer',
      status: 'success',
      data: {
        prioritizedScenarios: prioritized,
        scores: Object.fromEntries(scores),
        totalScenarios: prioritized.length,
      },
    };
  } catch (err) {
    logger.error('Prioritizer failed', err);
    return { moduleName: 'prioritizer', status: 'error', error: String(err) };
  }
}
