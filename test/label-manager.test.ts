import { LabelManager } from '../src/modules/reporter/label-manager';
import { TestResult } from '../src/types';

const mockGitHub = {
  addLabel: jest.fn().mockResolvedValue(undefined),
  postComment: jest.fn(),
  getPR: jest.fn(),
  createIssue: jest.fn(),
};

describe('LabelManager', () => {
  let manager: LabelManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new LabelManager(mockGitHub as any);
  });

  const pass: TestResult = { scenario: 'test', status: 'pass', device: 'Pixel', duration: 1000 };
  const fail: TestResult = { scenario: 'test', status: 'fail', device: 'Pixel', duration: 1000 };
  const warn: TestResult = { scenario: 'test', status: 'warn', device: 'Pixel', duration: 1000 };

  it('adds tests-passed label when all pass', async () => {
    const labels = await manager.updateLabels('o', 'r', 1, [pass]);
    expect(labels).toContain('tests-passed');
    expect(labels).not.toContain('tests-failed');
  });

  it('adds tests-failed label when any fail', async () => {
    const labels = await manager.updateLabels('o', 'r', 1, [pass, fail]);
    expect(labels).toContain('tests-failed');
    expect(labels).not.toContain('tests-passed');
  });

  it('adds tests-warning label when warnings but no failures', async () => {
    const labels = await manager.updateLabels('o', 'r', 1, [pass, warn]);
    expect(labels).toContain('tests-warning');
  });

  it('adds accessibility-issues label when flagged', async () => {
    const labels = await manager.updateLabels('o', 'r', 1, [pass], { accessibilityIssues: true });
    expect(labels).toContain('accessibility-issues');
  });

  it('adds performance-regression label when flagged', async () => {
    const labels = await manager.updateLabels('o', 'r', 1, [pass], { performanceRegression: true });
    expect(labels).toContain('performance-regression');
  });

  it('returns empty labels for empty results', async () => {
    const labels = await manager.updateLabels('o', 'r', 1, []);
    expect(labels).toEqual([]);
  });
});
