// The executor's XPath helpers are not exported; we re-implement the rules here against the
// same contract. If the helpers are extracted to a shared util, swap the import.
// This test documents the escaping behavior that guards against XPath injection.

function xpathLiteral(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  const parts = value.split('"').map((part) => `"${part}"`);
  return `concat(${parts.join(", '\"', ")})`;
}

function isSafeElementId(value: string): boolean {
  return /^[A-Za-z0-9_\- .:/]{1,200}$/.test(value);
}

describe('xpathLiteral', () => {
  it('wraps plain strings in double quotes', () => {
    expect(xpathLiteral('login_button')).toBe('"login_button"');
  });

  it('wraps strings containing double quotes in single quotes', () => {
    expect(xpathLiteral('he said "hi"')).toBe('\'he said "hi"\'');
  });

  it('wraps strings containing single quotes in double quotes', () => {
    expect(xpathLiteral("it's me")).toBe('"it\'s me"');
  });

  it('uses concat() for strings containing both quote styles', () => {
    const result = xpathLiteral('he said "it\'s me"');
    expect(result.startsWith('concat(')).toBe(true);
    // concat(..., '"', ...) construction — must produce parseable XPath.
    expect(result).toContain('\'"\'');
  });
});

describe('isSafeElementId', () => {
  it('accepts normal resource-ids and accessibility-ids', () => {
    expect(isSafeElementId('login_button')).toBe(true);
    expect(isSafeElementId('com.example:id/btn')).toBe(true);
    expect(isSafeElementId('My Account Page')).toBe(true);
  });

  it('rejects obvious XPath injection payloads', () => {
    expect(isSafeElementId('"] or 1=1 or @text="')).toBe(false);
    expect(isSafeElementId('foo" or //*[')).toBe(false);
    expect(isSafeElementId('<script>')).toBe(false);
  });

  it('rejects empty and over-long inputs', () => {
    expect(isSafeElementId('')).toBe(false);
    expect(isSafeElementId('a'.repeat(201))).toBe(false);
  });
});
