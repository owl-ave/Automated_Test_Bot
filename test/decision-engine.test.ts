import { DecisionEngine } from '../src/modules/ai-validator/decision-engine';
import { ComparisonResult } from '../src/modules/ai-validator/comparator';
import { VisualCheckResult } from '../src/modules/ai-validator/visual-checker';
import { TestResult } from '../src/types';

describe('DecisionEngine', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine();
  });

  const passResult: TestResult = {
    scenario: 'Login test',
    status: 'pass',
    device: 'Pixel 8',
    duration: 5000,
  };

  const failResult: TestResult = {
    scenario: 'Login test',
    status: 'fail',
    device: 'Pixel 8',
    duration: 3000,
    error: 'Element not found',
  };

  const warnResult: TestResult = {
    scenario: 'Login test',
    status: 'warn',
    device: 'Pixel 8',
    duration: 4000,
  };

  const highConfidenceMatch: ComparisonResult = {
    match: true,
    confidence: 95,
    details: 'Exact match',
  };

  const lowConfidenceMatch: ComparisonResult = {
    match: true,
    confidence: 75,
    details: 'Partial match',
  };

  const mismatch: ComparisonResult = {
    match: false,
    confidence: 30,
    details: 'No match found',
  };

  const visualPass: VisualCheckResult = {
    passed: true,
    confidence: 90,
    description: 'Screen looks correct',
    issues: [],
  };

  const visualFail: VisualCheckResult = {
    passed: false,
    confidence: 85,
    description: 'Layout broken',
    issues: ['Overlapping elements', 'Text truncated'],
  };

  it('returns pass when all signals pass', () => {
    const result = engine.decide(highConfidenceMatch, visualPass, passResult);
    expect(result.verdict).toBe('pass');
    expect(result.confidence).toBeGreaterThanOrEqual(85);
    expect(result.requiresReview).toBe(false);
  });

  it('returns fail when test execution fails with high confidence', () => {
    const result = engine.decide(null, null, failResult);
    expect(result.verdict).toBe('fail');
  });

  it('returns fail when multiple signals fail', () => {
    const result = engine.decide(mismatch, visualFail, failResult);
    expect(result.verdict).toBe('fail');
    expect(result.requiresReview).toBe(false);
  });

  it('returns warn when test execution warns', () => {
    const result = engine.decide(null, null, warnResult);
    expect(result.verdict).toBe('warn');
  });

  it('returns warn for low confidence comparator match', () => {
    const result = engine.decide(lowConfidenceMatch, null, passResult);
    expect(result.verdict).toBe('warn');
  });

  it('returns warn with no signals', () => {
    const result = engine.decide(null, null, { ...passResult, status: 'warn' });
    expect(result.verdict).toBe('warn');
    expect(result.requiresReview).toBe(true);
  });

  it('downgrades single low-confidence fail to warn', () => {
    const lowConfidenceFail: ComparisonResult = { match: false, confidence: 50, details: 'Uncertain' };
    const result = engine.decide(lowConfidenceFail, visualPass, passResult);
    expect(result.verdict).toBe('warn');
    expect(result.requiresReview).toBe(true);
  });

  it('includes reasons from all signals', () => {
    const result = engine.decide(highConfidenceMatch, visualPass, passResult);
    expect(result.reasons.length).toBe(3);
    expect(result.reasons.some((r) => r.includes('[execution]'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('[comparator]'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('[visual]'))).toBe(true);
  });
});
