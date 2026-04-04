import { PrCommenter } from '../src/modules/reporter/pr-commenter';
import { PipelineContext, TestResult } from '../src/types';

const mockGitHub = {
  postComment: jest.fn().mockResolvedValue(undefined),
  getPR: jest.fn(),
  addLabel: jest.fn(),
  createIssue: jest.fn(),
};

describe('PrCommenter', () => {
  let commenter: PrCommenter;

  beforeEach(() => {
    jest.clearAllMocks();
    commenter = new PrCommenter(mockGitHub as any);
  });

  const makeContext = (results: TestResult[]): PipelineContext => ({
    prNumber: 42,
    repoOwner: 'testOrg',
    repoName: 'testRepo',
    branch: 'feature/test',
    targetPath: '/tmp/test',
    diffFiles: [],
    testResults: results,
    logs: [],
    moduleStatuses: [],
  });

  const passResult: TestResult = {
    scenario: 'Login test',
    status: 'pass',
    device: 'Pixel 8',
    duration: 5000,
  };

  const failResult: TestResult = {
    scenario: 'Checkout test',
    status: 'fail',
    device: 'iPhone 15',
    duration: 3000,
    error: 'Button not found',
    screenshot: 'https://example.com/screenshot.png',
  };

  const warnResult: TestResult = {
    scenario: 'Search test',
    status: 'warn',
    device: 'Samsung S24',
    duration: 8000,
    error: 'Slow load time',
  };

  it('generates report with header', () => {
    const report = commenter.generateReport(makeContext([passResult]));
    expect(report).toContain('## Automated Testing Bot Report');
  });

  it('includes summary table with counts', () => {
    const report = commenter.generateReport(makeContext([passResult, failResult, warnResult]));
    expect(report).toContain('| Passed | 1 |');
    expect(report).toContain('| Failed | 1 |');
    expect(report).toContain('| Warnings | 1 |');
    expect(report).toContain('| Total Tests | 3 |');
  });

  it('shows FAILED status icon when tests fail', () => {
    const report = commenter.generateReport(makeContext([failResult]));
    expect(report).toContain('FAILED');
  });

  it('shows PASSED status when all pass', () => {
    const report = commenter.generateReport(makeContext([passResult]));
    expect(report).toContain('PASSED');
  });

  it('includes failed test details with error and screenshot', () => {
    const report = commenter.generateReport(makeContext([failResult]));
    expect(report).toContain('Checkout test');
    expect(report).toContain('Button not found');
    expect(report).toContain('screenshot.png');
  });

  it('includes warnings section', () => {
    const report = commenter.generateReport(makeContext([warnResult]));
    expect(report).toContain('Search test');
    expect(report).toContain('Slow load time');
  });

  it('wraps passing tests in collapsible details', () => {
    const report = commenter.generateReport(makeContext([passResult]));
    expect(report).toContain('<details>');
    expect(report).toContain('</details>');
  });

  it('includes device names in summary', () => {
    const report = commenter.generateReport(makeContext([passResult, failResult]));
    expect(report).toContain('Pixel 8');
    expect(report).toContain('iPhone 15');
  });

  it('includes test environment section with framework info', () => {
    const ctx = makeContext([passResult]);
    ctx.codeAnalysis = {
      framework: 'swift',
      screens: [],
      apiEndpoints: [],
      industry: 'banking',
      criticalFlows: [],
    };
    ctx.appBuild = {
      iosAppUrl: 'bs://abc123',
      iosCustomId: 'ios-pr-42',
      buildTimestamp: '2026-01-01T00:00:00Z',
    };
    const report = commenter.generateReport(ctx);
    expect(report).toContain('Test Environment');
    expect(report).toContain('iOS Native (Swift)');
    expect(report).toContain('ios-pr-42');
    expect(report).toContain('feature/test');
  });

  it('includes environment section even without codeAnalysis', () => {
    const report = commenter.generateReport(makeContext([passResult]));
    expect(report).toContain('Test Environment');
    expect(report).toContain('unknown');
  });

  it('includes BrowserStack session link in failed tests', () => {
    const failWithSession: TestResult = {
      ...failResult,
      sessionId: 'sess-abc123',
    };
    const report = commenter.generateReport(makeContext([failWithSession]));
    expect(report).toContain('View on BrowserStack');
    expect(report).toContain('sessions/sess-abc123');
  });

  it('posts report to GitHub', async () => {
    await commenter.postReport('owner', 'repo', 1, 'test report');
    expect(mockGitHub.postComment).toHaveBeenCalledWith('owner', 'repo', 1, 'test report');
  });

  it('handles empty test results', () => {
    const report = commenter.generateReport(makeContext([]));
    expect(report).toContain('## Automated Testing Bot Report');
    expect(report).toContain('No tests were executed on real devices.');
    expect(report).not.toContain('| Total Tests |');
  });

  it('includes video URL in failed test report', () => {
    const failWithVideo: TestResult = {
      ...failResult,
      videoUrl: 'https://app-automate.browserstack.com/sessions/abc123/video',
    };
    const report = commenter.generateReport(makeContext([failWithVideo]));
    expect(report).toContain('Watch Test Recording');
    expect(report).toContain('https://app-automate.browserstack.com/sessions/abc123/video');
  });

  it('includes video URL in passing test report', () => {
    const passWithVideo: TestResult = {
      ...passResult,
      videoUrl: 'https://app-automate.browserstack.com/sessions/def456/video',
    };
    const report = commenter.generateReport(makeContext([passWithVideo]));
    expect(report).toContain('Watch');
    expect(report).toContain('https://app-automate.browserstack.com/sessions/def456/video');
  });

  it('includes video URL in warnings section', () => {
    const warnWithVideo: TestResult = {
      ...warnResult,
      videoUrl: 'https://app-automate.browserstack.com/sessions/ghi789/video',
    };
    const report = commenter.generateReport(makeContext([warnWithVideo]));
    expect(report).toContain('Watch Video');
    expect(report).toContain('https://app-automate.browserstack.com/sessions/ghi789/video');
  });

  it('shows dash when video URL is missing in passing tests table', () => {
    const report = commenter.generateReport(makeContext([passResult]));
    expect(report).toMatch(/\| Login test \| Pixel 8 \| [\d.]+s \| - \|/);
  });

  it('includes performance logs when present', () => {
    const ctx = makeContext([passResult]);
    ctx.logs = ['[perf] App launch time: 1.2s', '[perf] FPS: 58'];
    const report = commenter.generateReport(ctx);
    expect(report).toContain('App launch time: 1.2s');
    expect(report).toContain('FPS: 58');
  });
});
