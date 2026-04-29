import { PipelineContext, ModuleResult } from '../../types';
import { Logger } from '../../utils/logger';
import { RiskScorer, HistoricalTestRun } from './risk-scorer';
import { TestScheduler } from './scheduler';

export { RiskScorer, HistoricalTestRun } from './risk-scorer';
export { TestScheduler } from './scheduler';

export async function runPrioritizer(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('Prioritizer');

  try {
    const flows = context.maestroFlows;
    if (!flows || flows.length === 0) {
      // No flows yet — still do file-level risk scoring on diffFiles so the
      // reporter can show which changed areas are highest risk.
      logger.log('No Maestro flows — running diff-based file risk scoring as fallback');
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
          prioritizedFlows: [],
          prioritizedFiles,
          scores: {},
          totalFlows: 0,
          note: 'No Maestro flows available — showing file-level risk scores instead',
        },
      };
    }

    const scorer = new RiskScorer();
    const scheduler = new TestScheduler({ failFast: true, platformSpecific: true });

    const scores = new Map<string, number>();
    for (const flow of flows) {
      const historicalData: HistoricalTestRun[] = [];
      const score = scorer.scoreTest(flow, context.diffFiles, historicalData);
      scores.set(flow.scenario, score);
    }

    const prioritized = scheduler.prioritize(flows, scores, context.diffFiles);

    logger.log(`Prioritized ${prioritized.length} flows`);

    return {
      moduleName: 'prioritizer',
      status: 'success',
      data: {
        prioritizedFlows: prioritized,
        scores: Object.fromEntries(scores),
        totalFlows: prioritized.length,
      },
    };
  } catch (err) {
    logger.error('Prioritizer failed', err);
    return { moduleName: 'prioritizer', status: 'error', error: String(err) };
  }
}
