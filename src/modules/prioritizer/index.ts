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
      // No BDD scenarios yet — still do file-level risk scoring on diffFiles so
      // the reporter can show which changed areas are highest risk
      logger.log('No BDD scenarios — running diff-based file risk scoring as fallback');
      const prioritizedFiles = (context.diffFiles || [])
        .map((f) => {
          const isUi = /screen|activity|fragment|composable|viewcontroller|view/i.test(f.path);
          const isAuth = /auth|login|signup|password/i.test(f.path);
          const isPayment = /pay|checkout|billing|cart/i.test(f.path);
          const riskScore = (isUi ? 30 : 0) + (isAuth ? 40 : 0) + (isPayment ? 40 : 0) +
            Math.min(f.additions + f.deletions, 30);
          return { file: f.path, riskScore, changeSize: f.additions + f.deletions };
        })
        .sort((a, b) => b.riskScore - a.riskScore);

      return {
        moduleName: 'prioritizer',
        status: 'success',
        data: {
          prioritizedScenarios: [],
          prioritizedFiles,
          scores: {},
          totalScenarios: 0,
          note: 'No BDD scenarios available — showing file-level risk scores instead',
        },
      };
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
