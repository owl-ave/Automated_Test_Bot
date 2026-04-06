import { PipelineContext, ModuleResult, TestResult, BddScenario } from '../../types';
import { OutputComparator } from './comparator';
import { VisualChecker } from './visual-checker';
import { DecisionEngine, DecisionResult } from './decision-engine';
import { FalsePositiveDetector } from './false-positive';
import { BugReproducer, BugReport } from './bug-reproducer';
import { getMinimalDeviceSet } from '../browserstack/device-matrix';
import { TestExecutor } from '../browserstack/executor';
import { Logger } from '../../utils/logger';

const logger = new Logger('AiValidator');

interface ValidationSummary {
  total: number;
  passed: number;
  failed: number;
  warned: number;
  falsePositives: number;
  bugReports: BugReport[];
  decisions: Array<{ scenario: string; device: string; decision: DecisionResult }>;
}

/** Static validation when no real-device test results are available */
async function runStaticScenarioValidation(context: PipelineContext): Promise<ModuleResult> {
  const scenarios = context.scenariosBdd ?? [];
  if (scenarios.length === 0) {
    return { moduleName: 'AiValidator', status: 'warning', error: 'No test results and no scenarios to validate' };
  }

  logger.log('No test results — running static BDD scenario quality check', { scenarios: scenarios.length });

  const issues: Array<{ scenario: string; issue: string; severity: 'error' | 'warning' }> = [];

  const validKeywords = ['Given', 'When', 'Then', 'And', 'But'];
  const appiumPatterns = [
    /user taps on/i,
    /user types .* in/i,
    /user scrolls/i,
    /user swipes/i,
    /user waits for/i,
    /user should see/i,
    /text shows/i,
    /user goes back/i,
    /the app is launched/i,
  ];

  for (const s of scenarios) {
    if (!s.steps || s.steps.length === 0) {
      issues.push({ scenario: s.scenario, issue: 'Scenario has no steps', severity: 'error' });
      continue;
    }
    // Check every step has a valid keyword
    for (const step of s.steps) {
      if (!validKeywords.includes(step.keyword)) {
        issues.push({ scenario: s.scenario, issue: `Invalid keyword: "${step.keyword}"`, severity: 'error' });
      }
    }
    // Check at least one step matches an Appium-executable pattern
    const hasExecutableStep = s.steps.some((step) => appiumPatterns.some((p) => p.test(step.text)));
    if (!hasExecutableStep) {
      issues.push({ scenario: s.scenario, issue: 'No Appium-executable steps detected', severity: 'warning' });
    }
    // Check scenario has a Given and a Then
    const hasGiven = s.steps.some((st) => st.keyword === 'Given');
    const hasThen = s.steps.some((st) => st.keyword === 'Then');
    if (!hasGiven) issues.push({ scenario: s.scenario, issue: 'Missing Given step', severity: 'warning' });
    if (!hasThen) issues.push({ scenario: s.scenario, issue: 'Missing Then (assertion) step', severity: 'warning' });
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  logger.log('Static scenario validation complete', { scenarios: scenarios.length, issues: issues.length, errors: errorCount });

  return {
    moduleName: 'AiValidator',
    status: errorCount > 0 ? 'warning' : 'success',
    data: {
      mode: 'static',
      scenariosChecked: scenarios.length,
      issues,
      note: 'Real-device test results not available — static BDD quality check performed instead',
    },
  };
}

export async function runAiValidator(context: PipelineContext): Promise<ModuleResult> {
  try {
    const testResults = context.testResults;

    // No real-device results — run static validation on generated BDD scenarios instead
    if (!testResults || testResults.length === 0) {
      return runStaticScenarioValidation(context);
    }

    const comparator = new OutputComparator();
    const visualChecker = new VisualChecker();
    const decisionEngine = new DecisionEngine();
    const falsePositiveDetector = new FalsePositiveDetector();
    const bugReproducer = new BugReproducer();
    const executor = new TestExecutor();

    const summary: ValidationSummary = {
      total: testResults.length,
      passed: 0,
      failed: 0,
      warned: 0,
      falsePositives: 0,
      bugReports: [],
      decisions: [],
    };

    for (const result of testResults) {
      // Visual validation if screenshot available
      let visualResult = null;
      if (result.screenshot) {
        visualResult = await visualChecker.checkScreenshot(
          result.screenshot,
          `Screen after executing scenario: ${result.scenario}`,
        );
      }

      // Text comparison (compare error state)
      let comparatorResult = null;
      if (result.error) {
        comparatorResult = comparator.compare('', result.error);
      }

      // Aggregate decision
      const decision = decisionEngine.decide(comparatorResult, visualResult, result);

      summary.decisions.push({
        scenario: result.scenario,
        device: result.device,
        decision,
      });

      // Update result status based on AI decision
      result.status = decision.verdict;

      if (decision.verdict === 'pass') {
        summary.passed++;
      } else if (decision.verdict === 'warn') {
        summary.warned++;
      } else {
        // For failures, check for false positives
        if (decision.requiresReview && context.scenariosBdd && context.appBuild) {
          const scenario = context.scenariosBdd.find((s) => s.scenario === result.scenario);
          const appUrl = context.appBuild.androidAppUrl || context.appBuild.iosAppUrl || '';

          if (scenario && appUrl) {
            const devices = getMinimalDeviceSet();
            const matchingDevice = devices.find((d) => d.name === result.device) || devices[0];

            if (matchingDevice) {
              const verification = await falsePositiveDetector.verify(result, scenario, appUrl, matchingDevice);

              if (!verification.isRealBug) {
                summary.falsePositives++;
                result.status = 'warn';
                summary.warned++;
                logger.log('False positive detected', { scenario: result.scenario, analysis: verification.analysis });
                continue;
              }
            }
          }
        }

        // Generate bug report for real failures
        summary.failed++;
        const sessionLogs = await executor.getSessionLogs(result.sessionId || result.device).catch(() => '');
        const bugReport = await bugReproducer.reproduce(result, sessionLogs);
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
      falsePositives: summary.falsePositives,
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
