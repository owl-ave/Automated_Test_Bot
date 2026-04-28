// Defensively parse JSON from a Claude response. Claude sometimes wraps JSON in
// ```json fences, sometimes adds prose, sometimes returns only prose. Callers should
// treat `null` as "response was unparseable" and fall back to a conservative default.
export function safeJsonParse<T = unknown>(text: string): T | null {
  if (!text) return null;

  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to extract the first {...} or [...] block.
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    const candidate = (objMatch?.[0] && arrMatch?.[0])
      ? (objMatch[0].length >= arrMatch[0].length ? objMatch[0] : arrMatch[0])
      : (objMatch?.[0] ?? arrMatch?.[0] ?? null);

    if (!candidate) return null;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      return null;
    }
  }
}

export function safeJsonParseWithDefault<T>(text: string, fallback: T): T {
  const parsed = safeJsonParse<T>(text);
  return parsed ?? fallback;
}
