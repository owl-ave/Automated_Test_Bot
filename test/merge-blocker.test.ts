import { MergeBlocker } from '../src/modules/reporter/merge-blocker';
import { TestResult } from '../src/types';

const mockGitHub = {
  postComment: jest.fn(),
  getPR: jest.fn(),
  addLabel: jest.fn(),
  createIssue: jest.fn(),
};

describe('MergeBlocker', () => {
  let blocker: MergeBlocker;

  beforeEach(() => {
    blocker = new MergeBlocker(mockGitHub as any);
  });

  const pass: TestResult = { scenario: 'Login', status: 'pass', device: 'Pixel', duration: 1000 };
  const fail: TestResult = { scenario: 'Checkout', status: 'fail', device: 'iPhone', duration: 2000, error: 'Crash' };
  const warn: TestResult = { scenario: 'Search', status: 'warn', device: 'Pixel', duration: 3000 };

  describe('shouldBlockMerge()', () => {
    it('does not block when all tests pass', () => {
      const { blocked, reasons } = blocker.shouldBlockMerge([pass, warn]);
      expect(blocked).toBe(false);
      expect(reasons).toEqual([]);
    });

    it('blocks when any test fails', () => {
      const { blocked, reasons } = blocker.shouldBlockMerge([pass, fail]);
      expect(blocked).toBe(true);
      expect(reasons).toHaveLength(1);
      expect(reasons[0].scenario).toBe('Checkout');
      expect(reasons[0].error).toBe('Crash');
      expect(reasons[0].device).toBe('iPhone');
    });

    it('blocks with multiple failures', () => {
      const fail2: TestResult = {
        scenario: 'Payment',
        status: 'fail',
        device: 'Samsung',
        duration: 1500,
        error: 'Timeout',
      };
      const { blocked, reasons } = blocker.shouldBlockMerge([fail, fail2]);
      expect(blocked).toBe(true);
      expect(reasons).toHaveLength(2);
    });

    it('does not block on empty results', () => {
      const { blocked } = blocker.shouldBlockMerge([]);
      expect(blocked).toBe(false);
    });

    it('does not block when failure rate is below 10% with 1-2 failures', () => {
      // 1 fail out of 20+ tests = < 10%
      const manyPasses = Array.from({ length: 20 }, (_, i) => ({
        scenario: `Test ${i}`,
        status: 'pass' as const,
        device: i % 2 === 0 ? 'Pixel 8' : 'iPhone 15',
        duration: 1000,
      }));
      const oneFail: TestResult = { scenario: 'Flaky test', status: 'fail', device: 'Pixel 8', duration: 1000, error: 'Timeout' };
      const { blocked } = blocker.shouldBlockMerge([...manyPasses, oneFail]);
      expect(blocked).toBe(false);
    });

    it('blocks when failure rate exceeds 10%', () => {
      const fewPasses = Array.from({ length: 5 }, (_, i) => ({
        scenario: `Test ${i}`,
        status: 'pass' as const,
        device: 'Pixel 8',
        duration: 1000,
      }));
      const threeFails = Array.from({ length: 3 }, (_, i) => ({
        scenario: `Failing ${i}`,
        status: 'fail' as const,
        device: 'iPhone 15',
        duration: 1000,
        error: 'Crash',
      }));
      const { blocked } = blocker.shouldBlockMerge([...fewPasses, ...threeFails]);
      expect(blocked).toBe(true);
    });
  });
});
