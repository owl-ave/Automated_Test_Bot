import { PipelineContext, ModuleResult } from '../../types';
import { Logger } from '../../utils/logger';
import { AppMetrics, PerformanceMetric } from './app-metrics';
import { MemoryChecker } from './memory-checker';
import { BatteryChecker } from './battery-checker';
import { AppSizeTracker } from './app-size';
import { PerformanceRegressionDetector } from './regression-detector';

export async function runPerformance(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('Performance');
  logger.log('Starting performance module');

  const metrics: PerformanceMetric[] = [];
  const platform = context.codeAnalysis?.framework === 'swift' ? 'ios' : 'android';

  try {
    // App size check
    const sizeTracker = new AppSizeTracker();
    const appUrl = platform === 'android' ? context.appBuild?.androidAppUrl : context.appBuild?.iosAppUrl;

    if (appUrl) {
      const sizeMb = sizeTracker.measureSize(appUrl);
      if (sizeMb > 0) {
        metrics.push({
          name: 'app_size',
          value: sizeMb,
          unit: 'MB',
          threshold: 100,
          status: sizeMb > 150 ? 'critical' : sizeMb > 100 ? 'warning' : 'ok',
        });

        const sizeReport = sizeTracker.compareWithBaseline(sizeMb, sizeMb * 0.95);
        context.logs.push(`[perf] App size: ${sizeMb}MB (delta: ${sizeReport.deltaMb}MB)`);
      }
    }

    // Note: driver-dependent metrics (launch time, FPS, memory, battery)
    // are collected during BrowserStack test execution.
    // This module provides the measurement classes for the executor to use.

    const appMetrics = new AppMetrics();
    const memoryChecker = new MemoryChecker();
    const batteryChecker = new BatteryChecker();

    // If we have a BrowserStack session driver, run live measurements
    const driver = (context as any).driver;
    if (driver) {
      const launchTime = await appMetrics.measureLaunchTime(driver, platform);
      metrics.push(launchTime.cold, launchTime.warm);

      const memoryMb = await memoryChecker.getMemoryUsage(driver, platform);
      if (memoryMb > 0) {
        metrics.push({
          name: 'memory_usage',
          value: memoryMb,
          unit: 'MB',
          threshold: 200,
          status: memoryMb > 300 ? 'critical' : memoryMb > 200 ? 'warning' : 'ok',
        });
      }

      const battery = await batteryChecker.estimateBatteryDrain(driver, platform, 30000);
      if (battery.drainPercent >= 0) {
        metrics.push({
          name: 'battery_drain_per_hour',
          value: battery.drainPerHour,
          unit: '%/hr',
          threshold: 10,
          status: battery.status === 'high' ? 'warning' : 'ok',
        });
      }
    }

    // Regression detection against baseline
    const baselineMetrics = (context as any).baselineMetrics as PerformanceMetric[] | undefined;
    let regressions: any[] = [];
    if (baselineMetrics && baselineMetrics.length > 0) {
      const detector = new PerformanceRegressionDetector();
      regressions = detector.detect(metrics, baselineMetrics);
      for (const r of regressions) {
        context.logs.push(
          `[perf] Regression: ${r.metric} ${r.current}${r.unit} vs baseline ${r.baseline}${r.unit} (${r.severity})`,
        );
      }
    }

    logger.log('Performance module completed', { metricCount: metrics.length });

    return {
      moduleName: 'performance',
      status: regressions.some((r: any) => r.severity === 'high') ? 'warning' : 'success',
      data: { metrics, regressions },
    };
  } catch (err) {
    logger.error('Performance module failed', err);
    return { moduleName: 'performance', status: 'error', error: String(err) };
  }
}
