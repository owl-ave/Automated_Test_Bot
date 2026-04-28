import * as crypto from 'crypto';
import { UIElement } from './page-source-parser';

// Screen fingerprint = sha256 of (sorted visible text labels + element-type counts).
// Stable across reruns of the same screen, changes when layout/copy changes.
// Excludes dynamic timestamps/counters by ignoring numeric-only labels and very long
// text (likely message bodies / lists). This is the cache key — over-specific
// fingerprints thrash the cache, under-specific ones risk wrong-screen hits.
export function fingerprint(elements: UIElement[]): string {
  if (!elements.length) return 'empty';

  const labels = new Set<string>();
  const typeCounts = new Map<string, number>();

  for (const el of elements) {
    if (!el.visible) continue;

    const t = el.type || 'Unknown';
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);

    for (const candidate of [el.text, el.label, el.contentDesc, el.name]) {
      if (!candidate) continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      // Skip numeric-only (counters, prices, timestamps) and very long strings.
      if (/^[\d.,:\-/\s]+$/.test(trimmed)) continue;
      if (trimmed.length > 60) continue;
      labels.add(trimmed.toLowerCase());
    }
  }

  const sortedLabels = [...labels].sort();
  const sortedTypes = [...typeCounts.entries()].sort(([a], [b]) => a.localeCompare(b));

  const payload = JSON.stringify({ labels: sortedLabels, types: sortedTypes });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
