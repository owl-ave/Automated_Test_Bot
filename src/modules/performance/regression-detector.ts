import { Logger } from '../../utils/logger';
import { PerformanceMetric } from './app-metrics';

export interface PerformanceRegression {
  metric: string;
  current: number;
  baseline: number;
  delta: number;
  deltaPercent: number;
  unit: string;
  severity: 'low' | 'medium' | 'high';
}

export class PerformanceRegressionDetector {
  private logger = new Logger('PerformanceRegressionDetector');
  private severityThresholds = { low: 10, medium: 25, high: 50 }; // percent

  detect(currentMetrics: PerformanceMetric[], baselineMetrics: PerformanceMetric[]): PerformanceRegression[] {
    const regressions: PerformanceRegression[] = [];
    const baselineMap = new Map(baselineMetrics.map((m) => [m.name, m]));

    for (const current of currentMetrics) {
      const baseline = baselineMap.get(current.name);
      if (!baseline || baseline.value <= 0 || current.value < 0) continue;

      const isHigherBetter = current.unit === 'fps';
      const delta = isHigherBetter ? baseline.value - current.value : current.value - baseline.value;

      if (delta <= 0) continue; // no regression

      const deltaPercent = Math.round((delta / baseline.value) * 10000) / 100;

      if (deltaPercent < this.severityThresholds.low) continue;

      const severity =
        deltaPercent >= this.severityThresholds.high
          ? 'high'
          : deltaPercent >= this.severityThresholds.medium
            ? 'medium'
            : 'low';

      regressions.push({
        metric: current.name,
        current: current.value,
        baseline: baseline.value,
        delta: Math.round(delta * 100) / 100,
        deltaPercent,
        unit: current.unit,
        severity,
      });
    }

    if (regressions.length > 0) {
      this.logger.warn('Performance regressions detected', { count: regressions.length });
    }

    return regressions;
  }
}
