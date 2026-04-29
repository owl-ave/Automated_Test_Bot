import { RiskScorer, HistoricalTestRun } from '../src/modules/prioritizer/risk-scorer';
import { MaestroFlow, DiffFile } from '../src/types';

describe('RiskScorer', () => {
  let scorer: RiskScorer;

  beforeEach(() => {
    scorer = new RiskScorer();
  });

  // Build a synthetic MaestroFlow whose YAML body carries the supplied step
  // labels — RiskScorer scans both the scenario name and the YAML for critical
  // keywords, so we mirror what a real flow would look like.
  const makeScenario = (feature: string, scenario: string, steps: string[] = []): MaestroFlow => {
    const body = ['- launchApp', ...steps.map((s) => `- tapOn: ${JSON.stringify(s)}`)].join('\n');
    return {
      feature,
      scenario,
      appId: 'com.example.app',
      fileName: `${scenario.toLowerCase().replace(/\s+/g, '-')}.yaml`,
      yaml: `appId: com.example.app\n---\n${body}\n`,
      issues: [],
    };
  };

  const makeDiff = (
    path: string,
    additions = 10,
    deletions = 5,
    status: 'added' | 'modified' | 'deleted' = 'modified',
  ): DiffFile => ({
    path,
    status,
    additions,
    deletions,
    patch: '',
  });

  it('returns a score between 0 and 100', () => {
    const scenario = makeScenario('Login', 'User logs in');
    const diffs = [makeDiff('src/login.ts')];
    const score = scorer.scoreTest(scenario, diffs);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scores critical flows higher', () => {
    const critical = makeScenario('Auth', 'User login with payment checkout');
    const nonCritical = makeScenario('Settings', 'User changes theme');
    const diffs = [makeDiff('src/app.ts')];

    const criticalScore = scorer.scoreTest(critical, diffs);
    const nonCriticalScore = scorer.scoreTest(nonCritical, diffs);
    expect(criticalScore).toBeGreaterThan(nonCriticalScore);
  });

  it('scores large changes higher', () => {
    const scenario = makeScenario('Feature', 'Test something');
    const smallDiffs = [makeDiff('src/a.ts', 5, 2)];
    const largeDiffs = [makeDiff('src/a.ts', 300, 200)];

    const smallScore = scorer.scoreTest(scenario, smallDiffs);
    const largeScore = scorer.scoreTest(scenario, largeDiffs);
    expect(largeScore).toBeGreaterThan(smallScore);
  });

  it('uses historical failure rate', () => {
    const scenario = makeScenario('Checkout', 'Complete order');
    const diffs = [makeDiff('src/checkout.ts')];

    const noHistory = scorer.scoreTest(scenario, diffs);

    const badHistory: HistoricalTestRun[] = [
      { scenario: 'Complete order', passed: false, device: 'Pixel 8', timestamp: '2026-01-01' },
      { scenario: 'Complete order', passed: false, device: 'Pixel 8', timestamp: '2026-01-02' },
      { scenario: 'Complete order', passed: true, device: 'Pixel 8', timestamp: '2026-01-03' },
    ];
    const highFailScore = scorer.scoreTest(scenario, diffs, badHistory);

    const goodHistory: HistoricalTestRun[] = [
      { scenario: 'Complete order', passed: true, device: 'Pixel 8', timestamp: '2026-01-01' },
      { scenario: 'Complete order', passed: true, device: 'Pixel 8', timestamp: '2026-01-02' },
    ];
    const lowFailScore = scorer.scoreTest(scenario, diffs, goodHistory);

    expect(highFailScore).toBeGreaterThan(lowFailScore);
  });

  it('scores native code changes with higher platform risk', () => {
    const scenario = makeScenario('Feature', 'Test something');
    const nativeDiffs = [makeDiff('src/Module.swift'), makeDiff('src/Bridge.kt')];
    const jsDiffs = [makeDiff('src/screen.tsx'), makeDiff('src/utils.ts')];

    const nativeScore = scorer.scoreTest(scenario, nativeDiffs);
    const jsScore = scorer.scoreTest(scenario, jsDiffs);
    expect(nativeScore).toBeGreaterThan(jsScore);
  });

  it('handles empty diff files', () => {
    const scenario = makeScenario('Feature', 'Test something');
    const score = scorer.scoreTest(scenario, []);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
