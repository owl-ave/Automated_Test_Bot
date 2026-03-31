import { Logger } from '../../utils/logger';

const logger = new Logger('OutputComparator');

export interface ComparisonResult {
  match: boolean;
  confidence: number;
  details: string;
}

export class OutputComparator {
  compare(expected: string, actual: string): ComparisonResult {
    if (!expected || !actual) {
      return { match: false, confidence: 0, details: 'Missing expected or actual value' };
    }

    const normalizedExpected = this.normalize(expected);
    const normalizedActual = this.normalize(actual);

    // Exact match
    if (normalizedExpected === normalizedActual) {
      return { match: true, confidence: 100, details: 'Exact match' };
    }

    // Contains check
    if (normalizedActual.includes(normalizedExpected)) {
      return { match: true, confidence: 95, details: 'Expected text found within actual output' };
    }

    // Fuzzy match using Levenshtein distance
    const similarity = this.calculateSimilarity(normalizedExpected, normalizedActual);

    if (similarity >= 0.9) {
      return {
        match: true,
        confidence: Math.round(similarity * 100),
        details: `High similarity: ${(similarity * 100).toFixed(1)}%`,
      };
    }

    if (similarity >= 0.7) {
      return {
        match: false,
        confidence: Math.round(similarity * 100),
        details: `Partial match: ${(similarity * 100).toFixed(1)}% similarity`,
      };
    }

    // Token-based comparison
    const tokenScore = this.tokenSimilarity(normalizedExpected, normalizedActual);
    if (tokenScore >= 0.8) {
      return {
        match: true,
        confidence: Math.round(tokenScore * 100),
        details: `Token match: ${(tokenScore * 100).toFixed(1)}% of expected tokens found`,
      };
    }

    const bestScore = Math.max(similarity, tokenScore);
    return {
      match: false,
      confidence: Math.round(bestScore * 100),
      details: `Low similarity: ${(bestScore * 100).toFixed(1)}%. Expected: "${expected.substring(0, 100)}", Got: "${actual.substring(0, 100)}"`,
    };
  }

  compareStructured(expected: Record<string, unknown>, actual: Record<string, unknown>): ComparisonResult {
    const mismatches: string[] = [];
    let matchedFields = 0;
    let totalFields = 0;

    for (const key of Object.keys(expected)) {
      totalFields++;
      const expVal = JSON.stringify(expected[key]);
      const actVal = JSON.stringify(actual[key]);

      if (expVal === actVal) {
        matchedFields++;
      } else if (actual[key] === undefined) {
        mismatches.push(`Missing field: ${key}`);
      } else {
        mismatches.push(`${key}: expected ${expVal}, got ${actVal}`);
      }
    }

    const confidence = totalFields > 0 ? Math.round((matchedFields / totalFields) * 100) : 0;
    const match = mismatches.length === 0;

    return {
      match,
      confidence,
      details: match ? 'All fields match' : `Mismatches: ${mismatches.join('; ')}`,
    };
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  private calculateSimilarity(a: string, b: string): number {
    if (a.length === 0 && b.length === 0) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    // Use shorter strings for performance on long texts
    const maxLen = 500;
    const sa = a.length > maxLen ? a.substring(0, maxLen) : a;
    const sb = b.length > maxLen ? b.substring(0, maxLen) : b;

    const distance = this.levenshteinDistance(sa, sb);
    const maxLength = Math.max(sa.length, sb.length);
    return 1 - distance / maxLength;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
      }
    }
    return matrix[a.length][b.length];
  }

  private tokenSimilarity(expected: string, actual: string): number {
    const expectedTokens = new Set(expected.split(/\s+/).filter((t) => t.length > 2));
    const actualTokens = new Set(actual.split(/\s+/));

    if (expectedTokens.size === 0) return 0;

    let matched = 0;
    for (const token of expectedTokens) {
      if (actualTokens.has(token)) matched++;
    }

    return matched / expectedTokens.size;
  }
}
