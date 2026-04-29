import { PipelineContext, ModuleResult } from '../../types';
import { OutputComparator } from './comparator';
import { VisualChecker } from './visual-checker';
import { DecisionEngine, DecisionResult } from './decision-engine';
import { BugReproducer, BugReport } from './bug-reproducer';
import { validateMaestroFlow, validateRun } from '../test-writer/maestro-validator';
import { resolveAppId } from '../test-writer/maestro-flow-generator';
import { Logger } from '../../utils/logger';

const logger = new Logger('AiValidator');

interface ValidationSummary {
  total: number;
  passed: number;
  failed: number;
  warned: number;
  bugReports: BugReport[];
  decisions: Array<{ scenario: string; device: string; decision: DecisionResult }>;
}

// When no real-device test results are available we still want to surface
// validator findings on the generated Maestro flows. This delegates to the
// same maestro-validator already enforced by TestWriter — duplicate checks are
// fine, the function is pure.
async function runStaticFlowValidation(context: PipelineContext): Promise<ModuleResult> {
  const flows = context.maestroFlows ?? [];
  if (flows.length === 0) {
    return { moduleName: 'AiValidator', status: 'skipped', error: 'no test results and no Maestro flows to validate' };
  }
  if (!context.codeAnalysis) {
    return { moduleName: 'AiValidator', status: 'warning', error: 'codeAnalysis missing — cannot run vocab-aware validation' };
  }

  logger.log('No test results — running static Maestro flow validation', { flows: flows.length });

  const expectedAppIds = resolveAppId(context.codeAnalysis.framework, context.mobilePath);
  const issues = flows.flatMap((f) =>
    validateMaestroFlow(f, { codeAnalysis: context.codeAnalysis!, expectedAppIds }).map((i) => ({ ...i, scenario: f.scenario })),
  );
  const runIssues = validateRun(flows);

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  logger.log('Static flow validation complete', { flows: flows.length, issues: issues.length, errors: errorCount });

  return {
    moduleName: 'AiValidator',
    status: errorCount > 0 ? 'warning' : 'success',
    data: {
      mode: 'static',
      flowsChecked: flows.length,
      issues: [...issues, ...runIssues],
      note: 'Real-device test results not available — Maestro flow validator run instead',
    },
  };
}

export async function runAiValidator(context: PipelineContext): Promise<ModuleResult> {
  try {
    const testResults = context.testResults;

    if (!testResults || testResults.length === 0) {
      return runStaticFlowValidation(context);
    }

    const comparator = new OutputComparator();
    const visualChecker = new VisualChecker();
    const decisionEngine = new DecisionEngine();
    const bugReproducer = new BugReproducer();

    const summary: ValidationSummary = {
      total: testResults.length,
      passed: 0,
      failed: 0,
      warned: 0,
      bugReports: [],
      decisions: [],
    };

    for (const result of testResults) {
      let visualResult = null;
      if (result.screenshot) {
        visualResult = await visualChecker.checkScreenshot(
          result.screenshot,
          `Screen after executing flow: ${result.scenario}`,
        );
      }

      let comparatorResult = null;
      if (result.error) {
        comparatorResult = comparator.compare('', result.error);
      }

      const decision = decisionEngine.decide(comparatorResult, visualResult, result);

      summary.decisions.push({
        scenario: result.scenario,
        device: result.device,
        decision,
      });

      result.status = decision.verdict;

      if (decision.verdict === 'pass') {
        summary.passed++;
      } else if (decision.verdict === 'warn') {
        summary.warned++;
      } else {
        // Maestro handles retries + flaky-test recovery server-side via its own
        // built-in retry policy. The legacy false-positive retry-on-different-
        // device path was Appium-specific and has been retired with the
        // executor. If we want cross-device verification back, it'd be a new
        // Maestro build invocation — out of scope for this migration.
        summary.failed++;
        const bugReport = await bugReproducer.reproduce(result, '');
        summary.bugReports.push(bugReport);
      }
    }

    const overallStatus = summary.failed > 0 ? 'warning' : 'success';
    const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

    logger.log('Validation complete', {
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      warned: summary.warned,
      bugReports: summary.bugReports.length,
      passRate,
    });

    return {
      moduleName: 'AiValidator',
      status: overallStatus,
      data: summary,
    };
  } catch (error) {
    logger.error('AI Validator module failed', error);
    return { moduleName: 'AiValidator', status: 'error', error: String(error) };
  }
}
