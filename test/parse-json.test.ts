import { safeJsonParse, safeJsonParseWithDefault } from '../src/ai/parse-json';

describe('safeJsonParse', () => {
  it('parses plain JSON objects', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses plain JSON arrays', () => {
    expect(safeJsonParse<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('strips ```json fences Claude often adds', () => {
    const text = '```json\n{"status":"pass","confidence":90}\n```';
    expect(safeJsonParse(text)).toEqual({ status: 'pass', confidence: 90 });
  });

  it('strips bare ``` fences', () => {
    const text = '```\n[1,2]\n```';
    expect(safeJsonParse(text)).toEqual([1, 2]);
  });

  it('extracts a JSON object embedded inside prose', () => {
    const text = 'Here is the report:\n{"status":"fail","confidence":10}\nEnd of response.';
    expect(safeJsonParse(text)).toEqual({ status: 'fail', confidence: 10 });
  });

  it('returns null when the text has no JSON', () => {
    expect(safeJsonParse('Sorry, I cannot analyze this screenshot.')).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(safeJsonParse('')).toBeNull();
  });

  it('does not throw when JSON is malformed and no fallback block exists', () => {
    expect(safeJsonParse('{"a": 1, "b":}')).toBeNull();
  });

  it('safeJsonParseWithDefault returns fallback on unparseable input', () => {
    const fallback = { status: 'warn', confidence: 0 };
    expect(safeJsonParseWithDefault('not json at all', fallback)).toEqual(fallback);
  });

  it('safeJsonParseWithDefault returns parsed value when valid', () => {
    expect(safeJsonParseWithDefault('{"ok":true}', { ok: false })).toEqual({ ok: true });
  });
});
