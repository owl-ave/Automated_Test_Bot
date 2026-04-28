// Pure heuristic functions for matching a step hint against an Appium page source.
// Extracted from locator-healer.ts so the runtime ElementResolver can reuse them
// pre-emptively (Tier 3 of resolution) without going through the post-failure heal
// flow. No class state, no I/O — easy to unit-test in isolation.

export interface MatchScore {
  value: string;
  score: number;
}

export interface HeuristicResult {
  matched: boolean;
  strategy: string;
  value: string;
  confidence: number;
  method: string;
}

const NO_MATCH: HeuristicResult = {
  matched: false,
  strategy: '',
  value: '',
  confidence: 0,
  method: '',
};

export function extractAttributes(pageSource: string, attrNames: string[]): string[] {
  const values: string[] = [];
  for (const attr of attrNames) {
    const pattern = new RegExp(`${attr}="([^"]+)"`, 'g');
    let match;
    while ((match = pattern.exec(pageSource)) !== null) {
      if (match[1].trim()) values.push(match[1].trim());
    }
  }
  return [...new Set(values)];
}

export function findBestMatch(target: string, candidates: string[]): MatchScore | null {
  if (candidates.length === 0) return null;

  const normalizedTarget = target.toLowerCase().replace(/[^a-z0-9]/g, '');
  let bestMatch = { value: '', score: 0 };

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (
      normalizedCandidate.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedCandidate)
    ) {
      const score =
        Math.min(normalizedTarget.length, normalizedCandidate.length) /
        Math.max(normalizedTarget.length, normalizedCandidate.length);
      if (score > bestMatch.score) {
        bestMatch = { value: candidate, score };
      }
      continue;
    }

    const targetTokens = new Set(normalizedTarget.split(/(?=[A-Z])|[-_\s]+/).filter(Boolean));
    const candidateTokens = new Set(normalizedCandidate.split(/(?=[A-Z])|[-_\s]+/).filter(Boolean));
    let overlap = 0;
    for (const t of targetTokens) {
      for (const c of candidateTokens) {
        if (t === c || t.includes(c) || c.includes(t)) overlap++;
      }
    }
    const tokenScore = targetTokens.size > 0 ? overlap / targetTokens.size : 0;
    if (tokenScore > bestMatch.score) {
      bestMatch = { value: candidate, score: tokenScore };
    }
  }

  return bestMatch.score > 0 ? bestMatch : null;
}

export function tryAccessibilityId(targetValue: string, pageSource: string): HeuristicResult {
  const ids = extractAttributes(pageSource, ['content-desc', 'accessibility-id', 'label', 'name']);
  const match = findBestMatch(targetValue, ids);
  if (match && match.score >= 0.5) {
    return {
      matched: true,
      strategy: 'accessibility id',
      value: match.value,
      confidence: Math.round(55 + match.score * 40),
      method: 'accessibility-id',
    };
  }
  return { ...NO_MATCH, method: 'accessibility-id' };
}

export function tryResourceId(targetValue: string, pageSource: string): HeuristicResult {
  const ids = extractAttributes(pageSource, ['resource-id', 'id']);
  const match = findBestMatch(targetValue, ids);
  if (match && match.score >= 0.5) {
    return {
      matched: true,
      strategy: 'id',
      value: match.value,
      confidence: Math.round(50 + match.score * 40),
      method: 'resource-id',
    };
  }
  return { ...NO_MATCH, method: 'resource-id' };
}

export function tryTextMatch(targetValue: string, pageSource: string): HeuristicResult {
  const texts = extractAttributes(pageSource, ['text', 'value', 'label']);
  const match = findBestMatch(targetValue, texts);
  if (match && match.score >= 0.6) {
    const xpath = `//*[contains(@text,"${escapeXPath(match.value)}") or contains(@label,"${escapeXPath(match.value)}")]`;
    return {
      matched: true,
      strategy: 'xpath',
      value: xpath,
      confidence: Math.round(40 + match.score * 35),
      method: 'text-match',
    };
  }
  return { ...NO_MATCH, method: 'text-match' };
}

export function tryXPath(targetValue: string, pageSource: string): HeuristicResult {
  const originalName = extractElementName(targetValue);
  if (!originalName) return { ...NO_MATCH, method: 'xpath' };

  const uiTypes = [
    'android.widget.Button',
    'android.widget.EditText',
    'android.widget.TextView',
    'android.widget.ImageView',
    'android.widget.ImageButton',
    'XCUIElementTypeButton',
    'XCUIElementTypeTextField',
    'XCUIElementTypeStaticText',
    'XCUIElementTypeImage',
  ];

  for (const uiType of uiTypes) {
    if (pageSource.includes(uiType)) {
      const xpath = `//${uiType}[contains(@text,"${escapeXPath(originalName)}") or contains(@content-desc,"${escapeXPath(originalName)}") or contains(@label,"${escapeXPath(originalName)}")]`;
      if (pageSource.toLowerCase().includes(originalName.toLowerCase())) {
        return {
          matched: true,
          strategy: 'xpath',
          value: xpath,
          confidence: 60,
          method: 'xpath-class',
        };
      }
    }
  }

  return { ...NO_MATCH, method: 'xpath' };
}

function extractElementName(locatorValue: string): string {
  const idMatch = locatorValue.match(/(?:id\/|:id\/)([^"'\]]+)/);
  if (idMatch) return idMatch[1];
  const textMatch = locatorValue.match(/(?:text|content-desc|label).*?["']([^"']+)["']/);
  if (textMatch) return textMatch[1];
  return locatorValue;
}

function escapeXPath(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
