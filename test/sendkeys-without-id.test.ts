// Regression test: WebDriverClient.sendKeys must NOT hardcode 'accessibility id'.
// Apps without test identifiers should be able to type into focused inputs via
// sendKeysToActiveElement (W3C "active element" endpoint).

import * as fs from 'fs';
import * as path from 'path';

const EXECUTOR_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'browserstack', 'executor.ts'),
  'utf-8',
);

describe('WebDriverClient — input methods (regression)', () => {
  it('sendKeys no longer hardcodes accessibility id', () => {
    // The previous bug: `this.findElement('accessibility id', elementId)` — crashed on
    // every typing step in apps without testIDs. The new version takes (strategy, value, text).
    const sendKeysBlock = extractMethod(EXECUTOR_SOURCE, 'sendKeys');
    expect(sendKeysBlock).toBeTruthy();
    expect(sendKeysBlock).not.toMatch(/findElement\(\s*['"]accessibility id['"]/);
    expect(sendKeysBlock).toMatch(/findElement\(strategy/);
  });

  it('exposes sendKeysToActiveElement that targets the W3C active element endpoint', () => {
    const block = extractMethod(EXECUTOR_SOURCE, 'sendKeysToActiveElement');
    expect(block).toBeTruthy();
    expect(block).toContain('/element/active');
  });
});

// Naive method-block extractor — finds `async <name>(` and returns until the matching
// closing brace. Good enough for a regression check; not a parser.
function extractMethod(source: string, name: string): string | null {
  const idx = source.indexOf(`async ${name}(`);
  if (idx === -1) return null;
  let depth = 0;
  let started = false;
  let end = idx;
  for (let i = idx; i < source.length; i++) {
    const c = source[i];
    if (c === '{') {
      depth++;
      started = true;
    } else if (c === '}') {
      depth--;
      if (started && depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return source.slice(idx, end);
}
