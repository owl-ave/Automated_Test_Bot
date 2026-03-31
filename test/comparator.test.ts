import { OutputComparator } from '../src/modules/ai-validator/comparator';

describe('OutputComparator', () => {
  let comparator: OutputComparator;

  beforeEach(() => {
    comparator = new OutputComparator();
  });

  describe('compare()', () => {
    it('returns no match when expected is empty', () => {
      const result = comparator.compare('', 'some actual');
      expect(result.match).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('returns no match when actual is empty', () => {
      const result = comparator.compare('expected', '');
      expect(result.match).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('returns exact match with 100% confidence', () => {
      const result = comparator.compare('Hello World', 'Hello World');
      expect(result.match).toBe(true);
      expect(result.confidence).toBe(100);
      expect(result.details).toBe('Exact match');
    });

    it('matches case-insensitively after normalization', () => {
      const result = comparator.compare('Hello World', 'hello world');
      expect(result.match).toBe(true);
      expect(result.confidence).toBe(100);
    });

    it('matches when expected is contained in actual', () => {
      const result = comparator.compare('welcome', 'Welcome to the app, user!');
      expect(result.match).toBe(true);
      expect(result.confidence).toBe(95);
    });

    it('returns high similarity for near-matches', () => {
      const result = comparator.compare('Login Successful', 'Login Successfull');
      expect(result.match).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(90);
    });

    it('returns no match for completely different strings', () => {
      const result = comparator.compare('Login Screen', 'Payment Checkout Complete');
      expect(result.match).toBe(false);
      expect(result.confidence).toBeLessThan(80);
    });

    it('handles whitespace differences', () => {
      const result = comparator.compare('Hello   World', 'Hello World');
      expect(result.match).toBe(true);
    });

    it('uses token similarity for reordered words', () => {
      const result = comparator.compare('user logged in successfully', 'successfully logged in user');
      expect(result.confidence).toBeGreaterThanOrEqual(80);
    });
  });

  describe('compareStructured()', () => {
    it('matches identical objects', () => {
      const obj = { name: 'John', age: 30 };
      const result = comparator.compareStructured(obj, obj);
      expect(result.match).toBe(true);
      expect(result.confidence).toBe(100);
    });

    it('detects missing fields', () => {
      const expected = { name: 'John', age: 30 };
      const actual = { name: 'John' };
      const result = comparator.compareStructured(expected, actual as any);
      expect(result.match).toBe(false);
      expect(result.details).toContain('Missing field: age');
    });

    it('detects value mismatches', () => {
      const expected = { name: 'John', age: 30 };
      const actual = { name: 'John', age: 25 };
      const result = comparator.compareStructured(expected, actual);
      expect(result.match).toBe(false);
      expect(result.confidence).toBe(50);
    });

    it('returns 0 confidence for empty expected', () => {
      const result = comparator.compareStructured({}, { name: 'John' });
      expect(result.match).toBe(true);
      expect(result.confidence).toBe(0);
    });
  });
});
