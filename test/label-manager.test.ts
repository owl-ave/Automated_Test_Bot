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

  it('adds android-tests-failed label when Android device fails', async () => {
    const androidFail: TestResult = { scenario: 'test', status: 'fail', device: 'Samsung Galaxy S24', duration: 1000 };
    const labels = await manager.updateLabels('o', 'r', 1, [androidFail]);
    expect(labels).toContain('android-tests-failed');
    expect(labels).not.toContain('ios-tests-failed');
  });

  it('adds ios-tests-failed label when iOS device fails', async () => {
    const iosFail: TestResult = { scenario: 'test', status: 'fail', device: 'iPhone 15 Pro', duration: 1000 };
    const labels = await manager.updateLabels('o', 'r', 1, [iosFail]);
    expect(labels).toContain('ios-tests-failed');
    expect(labels).not.toContain('android-tests-failed');
  });

  it('adds both platform labels when both fail', async () => {
    const androidFail: TestResult = { scenario: 'test', status: 'fail', device: 'Pixel 8', duration: 1000 };
    const iosFail: TestResult = { scenario: 'test', status: 'fail', device: 'iPad Air', duration: 1000 };
    const labels = await manager.updateLabels('o', 'r', 1, [androidFail, iosFail]);
    expect(labels).toContain('android-tests-failed');
    expect(labels).toContain('ios-tests-failed');
  });

  it('adds framework label when framework is provided', async () => {
    const labels = await manager.updateLabels('o', 'r', 1, [pass], { framework: 'swift' });
    expect(labels).toContain('framework:swift');
  });

  it('adds react-native framework label', async () => {
    const labels = await manager.updateLabels('o', 'r', 1, [pass], { framework: 'react-native' });
    expect(labels).toContain('framework:react-native');
  });
});
