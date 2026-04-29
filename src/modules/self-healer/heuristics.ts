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

// End-user-perspective locator strategies. Confidence ranges are deliberately
// stratified so that text and accessibility-label matches always outrank
// internal-identifier matches on a tie:
//
//   tryTextMatch          → 70–100   (visible text the user reads)
//   tryUserVisibleLabel   → 60–90    (label/name/content-desc — what TalkBack
//                                     and VoiceOver announce to the user)
//   tryInternalIdentifier → 30–55    (resource-id, iOS accessibility-identifier
//                                     and bare id — internal developer signals)
//   tryXPath              → flat 50  (class+text fallback)
//
// `MIN_ACCEPT_CONFIDENCE` in locator-healer.ts is 50, so an internal-identifier
// match still squeaks through when nothing else fires, but loses every tie to
// a text/label match.

export function tryTextMatch(targetValue: string, pageSource: string): HeuristicResult {
  const texts = extractAttributes(pageSource, ['text', 'value']);
  const match = findBestMatch(targetValue, texts);
  if (match && match.score >= 0.5) {
    const xpath = `//*[contains(@text,"${escapeXPath(match.value)}") or contains(@value,"${escapeXPath(match.value)}")]`;
    return {
      matched: true,
      strategy: 'xpath',
      value: xpath,
      confidence: Math.round(70 + match.score * 30),
      method: 'text-match',
    };
  }
  return { ...NO_MATCH, method: 'text-match' };
}

export function tryUserVisibleLabel(targetValue: string, pageSource: string): HeuristicResult {
  const labels = extractAttributes(pageSource, ['label', 'name', 'content-desc']);
  const match = findBestMatch(targetValue, labels);
  if (match && match.score >= 0.5) {
    const xpath = `//*[contains(@label,"${escapeXPath(match.value)}") or contains(@name,"${escapeXPath(match.value)}") or contains(@content-desc,"${escapeXPath(match.value)}")]`;
    return {
      matched: true,
      strategy: 'xpath',
      value: xpath,
      confidence: Math.round(60 + match.score * 30),
      method: 'user-visible-label',
    };
  }
  return { ...NO_MATCH, method: 'user-visible-label' };
}

export function tryInternalIdentifier(targetValue: string, pageSource: string): HeuristicResult {
  const ids = extractAttributes(pageSource, ['resource-id', 'accessibility-id', 'id']);
  const match = findBestMatch(targetValue, ids);
  // Stricter threshold (0.7) prevents fuzzy noise like `loginBtn` ↔ `login_button`
  // from beating an exact label match elsewhere.
  if (match && match.score >= 0.7) {
    return {
      matched: true,
      strategy: 'id',
      value: match.value,
      confidence: Math.round(30 + match.score * 25),
      method: 'internal-identifier',
    };
  }
  return { ...NO_MATCH, method: 'internal-identifier' };
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
          confidence: 50,
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
