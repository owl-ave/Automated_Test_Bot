import { PipelineContext, ModuleResult } from '../../types';
import { Logger } from '../../utils/logger';
import { NetworkChaos, NetworkChaosResult } from './network-chaos';
import { InterruptTester, InterruptResult } from './interrupt-tester';
import { OrientationTester, OrientationResult } from './orientation';
import { MonkeyTester, MonkeyTestResult } from './monkey-tester';

export { NetworkChaosResult } from './network-chaos';
export { InterruptResult } from './interrupt-tester';
export { OrientationResult } from './orientation';
export { MonkeyTestResult } from './monkey-tester';

interface ChaosTestingResult {
  networkTests: NetworkChaosResult[];
  interruptTests: InterruptResult[];
  orientationTests: OrientationResult[];
  monkeyTest: MonkeyTestResult | null;
  summary: {
    total: number;
    passed: number;
    failed: number;
    crashed: boolean;
  };
}

export async function runChaos(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('ChaosModule');
  logger.log('Starting chaos & resilience testing');

  const networkTests: NetworkChaosResult[] = [];
  const interruptTests: InterruptResult[] = [];
  const orientationTests: OrientationResult[] = [];
  let monkeyResult: MonkeyTestResult | null = null;

  try {
    const androidDriver = (context as any).androidDriver;
    const iosDriver = (context as any).iosDriver;
    const drivers: Array<{ driver: any; platform: string }> = [];

    if (androidDriver) drivers.push({ driver: androidDriver, platform: 'android' });
    if (iosDriver) drivers.push({ driver: iosDriver, platform: 'ios' });

    if (drivers.length === 0) {
      logger.warn('No drivers available for chaos testing — requires real device sessions (BrowserStack)');
      const screens = context.codeAnalysis?.screens?.map((s) => s.name) ?? [];
      return {
        moduleName: 'chaos',
        status: 'warning',
        data: {
          ...emptyResult(),
          pendingTests: ['offline-behavior', 'reconnection', 'slow-network', 'incoming-call',
                         'notification', 'app-switch', 'orientation', 'monkey-test'],
          pendingScreens: screens,
          note: 'Chaos tests identified but could not run — no real device sessions available',
        },
        error: 'No drivers available',
      };
    }

    const networkChaos = new NetworkChaos();
    const interruptTester = new InterruptTester();
    const orientationTester = new OrientationTester();
    const monkeyTester = new MonkeyTester();

    for (const { driver, platform } of drivers) {
      // Network chaos tests
      try {
        logger.log(`Running network chaos on ${platform}`);
        const offlineResult = await networkChaos.verifyOfflineBehavior(driver);
        networkTests.push(offlineResult);

        const reconnectResult = await networkChaos.verifyReconnection(driver);
        networkTests.push(reconnectResult);

        // Slow network test
        try {
          await networkChaos.simulateSlowNetwork(driver);
          await driver.pause(5000);
          const source = await driver.getPageSource().catch(() => '');
          networkTests.push({
            test: 'slow-network',
            passed: source.length > 0,
            details:
              source.length > 0 ? 'App remained responsive on slow network' : 'App became unresponsive on slow network',
          });
        } finally {
          await networkChaos.resetNetwork(driver);
        }
      } catch (err) {
        logger.error(`Network chaos failed on ${platform}`, err);
        networkTests.push({
          test: `network-chaos-${platform}`,
          passed: false,
          details: `Network chaos test error: ${err}`,
        });
      }

      // Interrupt tests
      try {
        logger.log(`Running interrupt tests on ${platform}`);
        const callResult = await interruptTester.simulateIncomingCall(driver, platform);
        interruptTests.push(callResult);

        const notifResult = await interruptTester.simulateNotification(driver);
        interruptTests.push(notifResult);

        const switchResult = await interruptTester.simulateAppSwitch(driver);
        interruptTests.push(switchResult);
      } catch (err) {
        logger.error(`Interrupt tests failed on ${platform}`, err);
        interruptTests.push({
          test: `interrupt-${platform}`,
          passed: false,
          details: `Interrupt test error: ${err}`,
          statePreserved: false,
        });
      }

      // Orientation tests
      try {
        logger.log(`Running orientation tests on ${platform}`);
        const screens = context.codeAnalysis?.screens || [];
        const screenNames = screens.length > 0 ? screens.map((s) => s.name) : ['current-screen'];

        for (const screen of screenNames.slice(0, 5)) {
          const result = await orientationTester.testOrientationChange(driver, screen);
          orientationTests.push(result);
        }

        // Rapid rotation stress test
        const rapidResult = await orientationTester.testRapidRotation(driver);
        orientationTests.push(rapidResult);
      } catch (err) {
        logger.error(`Orientation tests failed on ${platform}`, err);
        orientationTests.push({
          scenario: `orientation-${platform}`,
          passed: false,
          details: `Orientation test error: ${err}`,
          layoutPreserved: false,
          dataPreserved: false,
        });
      }

      // Monkey test (run on first available driver only — it's destructive)
      if (!monkeyResult) {
        try {
          logger.log(`Running monkey test on ${platform}`);
          monkeyResult = await monkeyTester.runMonkeyTest(driver, 30000, 2);
        } catch (err) {
          logger.error(`Monkey test failed on ${platform}`, err);
          monkeyResult = {
            crashed: true,
            actionsPerformed: 0,
            errors: [`Monkey test error: ${err}`],
            durationMs: 0,
          };
        }
      }
    }

    const summary = buildSummary(networkTests, interruptTests, orientationTests, monkeyResult);
    logger.log('Chaos testing complete', summary);

    const result: ChaosTestingResult = {
      networkTests,
      interruptTests,
      orientationTests,
      monkeyTest: monkeyResult,
      summary,
    };

    const hasFailures = summary.failed > 0 || summary.crashed;

    return {
      moduleName: 'chaos',
      status: hasFailures ? (summary.crashed ? 'error' : 'warning') : 'success',
      data: result,
    };
  } catch (err) {
    logger.error('Chaos module failed', err);
    return {
      moduleName: 'chaos',
      status: 'error',
      error: String(err),
      data: emptyResult(),
    };
  }
}

function buildSummary(
  networkTests: NetworkChaosResult[],
  interruptTests: InterruptResult[],
  orientationTests: OrientationResult[],
  monkeyResult: MonkeyTestResult | null,
) {
  const allPassed = [
    ...networkTests.map((t) => t.passed),
    ...interruptTests.map((t) => t.passed),
    ...orientationTests.map((t) => t.passed),
  ];

  const total = allPassed.length + (monkeyResult ? 1 : 0);
  const passed = allPassed.filter(Boolean).length + (monkeyResult && !monkeyResult.crashed ? 1 : 0);

  return {
    total,
    passed,
    failed: total - passed,
    crashed: monkeyResult?.crashed || false,
  };
}

function emptyResult(): ChaosTestingResult {
  return {
    networkTests: [],
    interruptTests: [],
    orientationTests: [],
    monkeyTest: null,
    summary: { total: 0, passed: 0, failed: 0, crashed: false },
  };
}
