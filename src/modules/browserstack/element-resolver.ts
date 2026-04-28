import { query } from '@anthropic-ai/claude-agent-sdk';
import { Logger } from '../../utils/logger';
import {
  parsePageSource,
  getInteractableElements,
  getElementsWithText,
  UIElement,
} from './page-source-parser';
import { fingerprint } from './screen-fingerprint';
import {
  tryAccessibilityId,
  tryResourceId,
  tryTextMatch,
  tryXPath,
  findBestMatch,
} from '../../modules/self-healer/heuristics';
import type { LocatorCache } from '../knowledge-base/locator-cache';

const logger = new Logger('ElementResolver');

export type ResolvedTarget =
  | {
      kind: 'locator';
      strategy: string;
      value: string;
      tier: number;
      source: string;
      confidence: number;
    }
  | {
      kind: 'coords';
      x: number;
      y: number;
      tier: number;
      source: string;
      confidence: number;
    }
  | {
      kind: 'unresolved';
      tried: string[];
      pageSourceSnippet?: string;
      visibleLabels?: string[];
    };

export interface ResolverContext {
  driver: any;
  platform: 'android' | 'ios';
  appVersion?: string;
  cache?: LocatorCache;
  // The hint role lets the resolver pick the right candidate set:
  // 'tap' / 'longpress' → interactable elements only
  // 'assert' / 'wait'   → any element with text
  // 'type'              → input-class elements
  intent?: 'tap' | 'longpress' | 'assert' | 'wait' | 'type';
  // Skip the Claude-call fallback (Tier 4). Set this in tests so the resolver returns
  // 'unresolved' deterministically without burning API calls.
  disableAiTier?: boolean;
}

const FUZZY_MATCH_THRESHOLD = 0.5;
const TYPE_INPUT_CLASSES = [
  'EditText',
  'XCUIElementTypeTextField',
  'XCUIElementTypeSecureTextField',
  'XCUIElementTypeSearchField',
  'TextInput',
];

export class ElementResolver {
  // Cache page source + parsed elements per session for the current screen.
  // Invalidated by the executor on screen-change events (post-tap navigation, app reset).
  private currentPageSource: string | null = null;
  private currentElements: UIElement[] = [];
  private currentFingerprint: string | null = null;

  invalidateScreen(): void {
    this.currentPageSource = null;
    this.currentElements = [];
    this.currentFingerprint = null;
  }

  async resolve(ctx: ResolverContext, hint: string): Promise<ResolvedTarget> {
    const tried: string[] = [];
    const normalizedHint = (hint || '').trim();
    if (!normalizedHint) {
      return { kind: 'unresolved', tried: ['empty-hint'] };
    }

    await this.refreshPageSourceIfNeeded(ctx);

    // Tier 0 — Locator cache.
    if (ctx.cache && ctx.appVersion && this.currentFingerprint) {
      const hit = await ctx.cache
        .lookup({
          appVersion: ctx.appVersion,
          screenFingerprint: this.currentFingerprint,
          hint: normalizedHint,
        })
        .catch(() => null);
      if (hit) {
        logger.debug('Resolver tier 0 hit (cache)', { hint: normalizedHint, hit });
        if (hit.x !== null && hit.y !== null) {
          return { kind: 'coords', x: hit.x, y: hit.y, tier: 0, source: 'cache', confidence: hit.confidence };
        }
        return {
          kind: 'locator',
          strategy: hit.strategy,
          value: hit.value,
          tier: 0,
          source: 'cache',
          confidence: hit.confidence,
        };
      }
      tried.push('tier0-cache-miss');
    }

    // Tier 1 — Parsed page source fuzzy match.
    const tier1 = this.matchInPageSource(normalizedHint, ctx.intent);
    if (tier1) {
      const result: ResolvedTarget = {
        kind: 'coords',
        x: tier1.element.bounds.centerX,
        y: tier1.element.bounds.centerY,
        tier: 1,
        source: 'page-source',
        confidence: Math.round(tier1.score * 100),
      };
      this.cacheResult(ctx, normalizedHint, result);
      logger.debug('Resolver tier 1 hit', { hint: normalizedHint, score: tier1.score });
      return result;
    }
    tried.push('tier1-page-source-miss');

    // Tier 2 — Standard Appium locator strategies. Only worth trying if the hint
    // looks like an identifier (no spaces, alphanumeric/underscore). Skip for prose
    // hints to avoid burning round-trips on guaranteed misses.
    if (this.looksLikeIdentifier(normalizedHint)) {
      const tier2 = await this.tryStandardLocators(ctx, normalizedHint);
      if (tier2) {
        this.cacheResult(ctx, normalizedHint, tier2);
        logger.debug('Resolver tier 2 hit', { hint: normalizedHint, strategy: tier2 });
        return tier2;
      }
      tried.push('tier2-standard-locator-miss');
    } else {
      tried.push('tier2-skipped-prose-hint');
    }

    // Tier 3 — Heuristic healer methods (regex-based attribute extraction).
    if (this.currentPageSource) {
      const tier3 = this.tryHeuristics(normalizedHint, ctx.platform);
      if (tier3) {
        this.cacheResult(ctx, normalizedHint, tier3);
        logger.debug('Resolver tier 3 hit', { hint: normalizedHint, result: tier3 });
        return tier3;
      }
      tried.push('tier3-heuristic-miss');
    }

    // Tier 4 — AI text reasoning over the page source XML.
    if (this.currentPageSource && !ctx.disableAiTier) {
      const tier4 = await this.tryAi(normalizedHint);
      if (tier4) {
        this.cacheResult(ctx, normalizedHint, tier4);
        logger.debug('Resolver tier 4 hit', { hint: normalizedHint });
        return tier4;
      }
      tried.push('tier4-ai-miss');
    } else if (ctx.disableAiTier) {
      tried.push('tier4-ai-disabled');
    }

    // Tier 5 — Structured fail.
    return {
      kind: 'unresolved',
      tried,
      pageSourceSnippet: this.currentPageSource?.slice(0, 800),
      visibleLabels: this.currentElements
        .map((e) => e.text || e.label || e.contentDesc || e.name)
        .filter((s): s is string => Boolean(s))
        .slice(0, 30),
    };
  }

  private async refreshPageSourceIfNeeded(ctx: ResolverContext): Promise<void> {
    if (this.currentPageSource) return;
    try {
      const source = await ctx.driver.getPageSource();
      this.currentPageSource = source;
      this.currentElements = parsePageSource(source);
      this.currentFingerprint = fingerprint(this.currentElements);
    } catch (err) {
      logger.warn('Could not fetch page source — resolver tiers 1/3/4 will be skipped', {
        error: String(err),
      });
      this.currentPageSource = null;
      this.currentElements = [];
      this.currentFingerprint = null;
    }
  }

  private matchInPageSource(
    hint: string,
    intent?: ResolverContext['intent'],
  ): { element: UIElement; score: number } | null {
    if (!this.currentElements.length) return null;

    let candidates: UIElement[];
    if (intent === 'type') {
      candidates = this.currentElements.filter((e) => this.isInputElement(e));
    } else if (intent === 'assert' || intent === 'wait') {
      candidates = getElementsWithText(this.currentElements);
    } else {
      candidates = getInteractableElements(this.currentElements);
      if (candidates.length === 0) {
        // Fall back to any element with text — handy for icon-only buttons in
        // hierarchies where Appium doesn't propagate the clickable bit.
        candidates = getElementsWithText(this.currentElements);
      }
    }

    let best: { element: UIElement; score: number } | null = null;
    for (const el of candidates) {
      const haystack = [el.text, el.label, el.contentDesc, el.name, el.resourceId, el.accessibilityId]
        .filter((s): s is string => Boolean(s));
      if (haystack.length === 0) continue;
      const m = findBestMatch(hint, haystack);
      if (!m) continue;
      if (best === null || m.score > best.score) {
        best = { element: el, score: m.score };
      }
    }

    if (!best || best.score < FUZZY_MATCH_THRESHOLD) return null;
    return best;
  }

  private isInputElement(el: UIElement): boolean {
    return TYPE_INPUT_CLASSES.some((cls) => el.type.includes(cls));
  }

  private looksLikeIdentifier(hint: string): boolean {
    return /^[A-Za-z][\w.\-:/]{0,80}$/.test(hint) && !hint.includes(' ');
  }

  private async tryStandardLocators(
    ctx: ResolverContext,
    hint: string,
  ): Promise<ResolvedTarget | null> {
    const strategies = ctx.platform === 'ios'
      ? ['accessibility id', 'name']
      : ['accessibility id', 'id'];

    for (const strategy of strategies) {
      try {
        const el = await ctx.driver.findElement(strategy, hint);
        if (el) {
          return {
            kind: 'locator',
            strategy,
            value: hint,
            tier: 2,
            source: 'standard-locator',
            confidence: 90,
          };
        }
      } catch {
        // not found with this strategy
      }
    }
    return null;
  }

  private tryHeuristics(hint: string, platform: 'android' | 'ios'): ResolvedTarget | null {
    if (!this.currentPageSource) return null;
    const ps = this.currentPageSource;

    const attempts =
      platform === 'ios'
        ? [tryAccessibilityId(hint, ps), tryTextMatch(hint, ps), tryXPath(hint, ps)]
        : [tryAccessibilityId(hint, ps), tryResourceId(hint, ps), tryTextMatch(hint, ps), tryXPath(hint, ps)];

    const best = attempts
      .filter((r) => r.matched)
      .reduce<typeof attempts[number] | null>(
        (acc, r) => (acc === null || r.confidence > acc.confidence ? r : acc),
        null,
      );

    if (!best || best.confidence < 50) return null;

    return {
      kind: 'locator',
      strategy: best.strategy,
      value: best.value,
      tier: 3,
      source: `heuristic:${best.method}`,
      confidence: best.confidence,
    };
  }

  private async tryAi(hint: string): Promise<ResolvedTarget | null> {
    if (!this.currentPageSource) return null;
    try {
      const truncated =
        this.currentPageSource.length > 8000
          ? this.currentPageSource.slice(0, 8000) + '\n... (truncated)'
          : this.currentPageSource;

      const prompt = `A mobile UI test step needs an element. Find the best locator.

Step target: ${hint}

Page source (XML):
${truncated}

Respond with ONLY valid JSON:
{
  "found": true|false,
  "strategy": "accessibility id" | "id" | "xpath" | "name",
  "value": "<locator value>",
  "confidence": 0-100,
  "reasoning": "<brief>"
}`;

      let text = '';
      for await (const message of query({
        prompt,
        options: { maxTurns: 1, model: 'claude-opus-4-6' },
      })) {
        if ('result' in message) text = message.result;
      }

      const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!parsed?.found) return null;

      const raw = typeof parsed.confidence === 'number' ? parsed.confidence : 50;
      const confidence = Math.max(30, Math.min(90, raw));
      return {
        kind: 'locator',
        strategy: String(parsed.strategy ?? 'xpath'),
        value: String(parsed.value ?? ''),
        tier: 4,
        source: 'ai-text',
        confidence,
      };
    } catch (err) {
      logger.warn('AI tier failed', { error: String(err) });
      return null;
    }
  }

  private cacheResult(ctx: ResolverContext, hint: string, result: ResolvedTarget): void {
    if (!ctx.cache || !ctx.appVersion || !this.currentFingerprint) return;
    if (result.kind === 'unresolved') return;

    const payload =
      result.kind === 'coords'
        ? { x: result.x, y: result.y, strategy: 'coords', value: '' }
        : { x: null, y: null, strategy: result.strategy, value: result.value };

    ctx.cache
      .store({
        appVersion: ctx.appVersion,
        screenFingerprint: this.currentFingerprint,
        hint,
        ...payload,
        confidence: result.confidence,
      })
      .catch((err) => logger.debug('Cache store failed (non-fatal)', { error: String(err) }));
  }
}
