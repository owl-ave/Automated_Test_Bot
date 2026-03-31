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
  });
});
