import { TestResult } from '../../types';
import { ComparisonResult } from './comparator';
import { VisualCheckResult } from './visual-checker';
import { getThresholds } from '../../config/thresholds';
import { Logger } from '../../utils/logger';

const logger = new Logger('DecisionEngine');

export type Verdict = 'pass' | 'warn' | 'fail';

export interface DecisionResult {
  verdict: Verdict;
  confidence: number;
  reasons: string[];
  requiresReview: boolean;
}

export class DecisionEngine {
  decide(
    comparatorResult: ComparisonResult | null,
    visualResult: VisualCheckResult | null,
    testResult: TestResult,
  ): DecisionResult {
    const signals: Array<{ source: string; verdict: Verdict; confidence: number; reason: string }> = [];

    // Signal 1: Test execution result
    if (testResult.status === 'pass') {
      signals.push({ source: 'execution', verdict: 'pass', confidence: 85, reason: 'Test execution passed' });
    } else if (testResult.status === 'fail') {
      signals.push({
        source: 'execution',
        verdict: 'fail',
        confidence: 80,
        reason: `Test failed: ${testResult.error || 'unknown error'}`,
      });
    } else {
      signals.push({ source: 'execution', verdict: 'warn', confidence: 60, reason: 'Test returned warning status' });
    }

    // Signal 2: Output comparison
    if (comparatorResult) {
      if (comparatorResult.match && comparatorResult.confidence >= 90) {
        signals.push({
          source: 'comparator',
          verdict: 'pass',
          confidence: comparatorResult.confidence,
          reason: comparatorResult.details,
        });
      } else if (comparatorResult.match) {
        signals.push({
          source: 'comparator',
          verdict: 'warn',
          confidence: comparatorResult.confidence,
          reason: `Partial match: ${comparatorResult.details}`,
        });
      } else {
        signals.push({
          source: 'comparator',
          verdict: 'fail',
          confidence: comparatorResult.confidence,
          reason: `Mismatch: ${comparatorResult.details}`,
        });
      }
    }

    // Signal 3: Visual analysis
    if (visualResult) {
      if (visualResult.passed && visualResult.confidence >= 80) {
        signals.push({
          source: 'visual',
          verdict: 'pass',
          confidence: visualResult.confidence,
          reason: visualResult.description,
        });
      } else if (visualResult.passed) {
        signals.push({
          source: 'visual',
          verdict: 'warn',
          confidence: visualResult.confidence,
          reason: `Visual check passed with low confidence: ${visualResult.description}`,
        });
      } else {
        const issuesSummary = visualResult.issues.slice(0, 3).join('; ');
        signals.push({
          source: 'visual',
          verdict: 'fail',
          confidence: visualResult.confidence,
          reason: `Visual issues: ${issuesSummary}`,
        });
      }
    }

    return this.aggregate(signals);
  }

  private aggregate(
    signals: Array<{ source: string; verdict: Verdict; confidence: number; reason: string }>,
  ): DecisionResult {
    if (signals.length === 0) {
      return { verdict: 'warn', confidence: 0, reasons: ['No validation signals available'], requiresReview: true };
    }

    const failSignals = signals.filter((s) => s.verdict === 'fail');
    const warnSignals = signals.filter((s) => s.verdict === 'warn');
    const passSignals = signals.filter((s) => s.verdict === 'pass');

    const reasons = signals.map((s) => `[${s.source}] ${s.reason}`);

    // Strong fail: multiple fail signals or a high-confidence fail
    if (failSignals.length >= 2 || failSignals.some((s) => s.confidence >= 85)) {
      const avgConfidence = this.avgConfidence(failSignals);
      return { verdict: 'fail', confidence: avgConfidence, reasons, requiresReview: false };
    }

    // Single fail with low confidence: warn
    if (failSignals.length === 1 && failSignals[0].confidence < 70) {
      return { verdict: 'warn', confidence: failSignals[0].confidence, reasons, requiresReview: true };
    }

    // Single fail with decent confidence
    if (failSignals.length === 1) {
      // Check if pass signals outnumber and outweigh the fail
      if (passSignals.length >= 2 && this.avgConfidence(passSignals) > failSignals[0].confidence) {
        return { verdict: 'warn', confidence: this.avgConfidence(signals), reasons, requiresReview: true };
      }
      return { verdict: 'fail', confidence: failSignals[0].confidence, reasons, requiresReview: true };
    }

    // Warnings only
    if (warnSignals.length > 0 && passSignals.length === 0) {
      return { verdict: 'warn', confidence: this.avgConfidence(warnSignals), reasons, requiresReview: true };
    }

    // Mix of pass and warn
    if (warnSignals.length > 0) {
      return { verdict: 'warn', confidence: this.avgConfidence(signals), reasons, requiresReview: false };
    }

    // All pass
    const avgConfidence = this.avgConfidence(passSignals);
    return { verdict: 'pass', confidence: avgConfidence, reasons, requiresReview: false };
  }

  private avgConfidence(signals: Array<{ confidence: number }>): number {
    if (signals.length === 0) return 0;
    return Math.round(signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length);
  }
}
