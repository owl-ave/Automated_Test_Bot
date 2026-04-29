import { query } from '@anthropic-ai/claude-agent-sdk';
import { Logger } from '../../utils/logger';
import {
  tryTextMatch as tryTextMatchFn,
  tryUserVisibleLabel as tryUserVisibleLabelFn,
  tryInternalIdentifier as tryInternalIdentifierFn,
  tryXPath as tryXPathFn,
  HeuristicResult,
} from './heuristics';

const logger = new Logger('LocatorHealer');

export interface LocatorStrategy {
  strategy: string;
  value: string;
}

export interface HealResult {
  healed: boolean;
  newStrategy: string;
  newValue: string;
  confidence: number;
  method: string;
}

function toHealResult(h: HeuristicResult): HealResult {
  return {
    healed: h.matched,
    newStrategy: h.strategy,
    newValue: h.value,
    confidence: h.confidence,
    method: h.method,
  };
}

async function askClaude(prompt: string): Promise<string> {
  let result = '';
  for await (const message of query({
    prompt,
    options: { maxTurns: 1, model: 'claude-opus-4-6' },
  })) {
    if ('result' in message) result = message.result;
  }
  return result;
}

// Minimum confidence required before we accept a healed locator. Below this the self-healer
// reports failure rather than returning a low-quality guess that would just fail at runtime.
const MIN_ACCEPT_CONFIDENCE = 50;

export class LocatorHealer {
  async healLocator(originalLocator: LocatorStrategy, pageSource: string, platform?: 'android' | 'ios'): Promise<HealResult> {
    logger.log('Healing broken locator', { strategy: originalLocator.strategy, value: originalLocator.value, platform });

    // Run ALL heuristic strategies in user-perspective order — visible text first,
    // then user-visible label (TalkBack/VoiceOver), then internal identifiers as
    // a low-confidence fallback. The reducer picks the single highest-confidence
    // candidate, so the rebalanced confidence ranges in heuristics.ts naturally
    // make text/label win every tie. AI fallback only runs if nothing clears
    // MIN_ACCEPT_CONFIDENCE.
    const heuristicTasks: Array<() => Promise<HealResult> | HealResult> = [
      () => this.tryTextMatch(originalLocator, pageSource),
      () => this.tryUserVisibleLabel(originalLocator, pageSource),
      () => this.tryInternalIdentifier(originalLocator, pageSource),
      () => this.tryXPath(originalLocator, pageSource),
    ];

    const heuristicResults = await Promise.all(heuristicTasks.map((fn) => Promise.resolve(fn())));
    const heuristicHealed = heuristicResults.filter((r) => r.healed);

    let best: HealResult | null = heuristicHealed.reduce<HealResult | null>(
      (acc, r) => (acc === null || r.confidence > acc.confidence ? r : acc),
      null,
    );

    if (!best || best.confidence < MIN_ACCEPT_CONFIDENCE) {
      const aiResult = await this.tryAiFallback(originalLocator, pageSource);
      if (aiResult.healed && (!best || aiResult.confidence > best.confidence)) {
        best = aiResult;
      }
    }

    if (best && best.healed && best.confidence >= MIN_ACCEPT_CONFIDENCE) {
      logger.log('Locator healed', {
        method: best.method,
        newStrategy: best.newStrategy,
        newValue: best.newValue,
        confidence: best.confidence,
      });
      return best;
    }

    logger.warn('Could not heal locator', { original: originalLocator, bestConfidence: best?.confidence ?? 0 });
    return {
      healed: false,
      newStrategy: originalLocator.strategy,
      newValue: originalLocator.value,
      confidence: 0,
      method: 'none',
    };
  }

  private tryTextMatch(original: LocatorStrategy, pageSource: string): HealResult {
    return toHealResult(tryTextMatchFn(original.value, pageSource));
  }

  private tryUserVisibleLabel(original: LocatorStrategy, pageSource: string): HealResult {
    return toHealResult(tryUserVisibleLabelFn(original.value, pageSource));
  }

  private tryInternalIdentifier(original: LocatorStrategy, pageSource: string): HealResult {
    return toHealResult(tryInternalIdentifierFn(original.value, pageSource));
  }

  private tryXPath(original: LocatorStrategy, pageSource: string): HealResult {
    return toHealResult(tryXPathFn(original.value, pageSource));
  }

  private async tryAiFallback(original: LocatorStrategy, pageSource: string): Promise<HealResult> {
    try {
      const truncatedSource =
        pageSource.length > 8000 ? pageSource.substring(0, 8000) + '\n... (truncated)' : pageSource;

      const text = await askClaude(`A mobile UI test locator is broken. Find the best alternative locator.

Original locator:
  Strategy: ${original.strategy}
  Value: ${original.value}

Current page source (XML):
${truncatedSource}

Respond with ONLY valid JSON:
{
  "found": true/false,
  "strategy": "accessibility id|id|xpath|class name",
  "value": "the locator value",
  "confidence": 0-100,
  "reasoning": "brief explanation"
}`);

      const cleaned = text
        .replace(/```json?\n?/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.found) {
        // Clamp AI-reported confidence to [30, 90] — the model is guessing from XML it cannot
        // actually query against; don't let it self-report 100% certainty.
        const rawConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 50;
        const confidence = Math.max(30, Math.min(90, rawConfidence));
        return {
          healed: true,
          newStrategy: parsed.strategy,
          newValue: parsed.value,
          confidence,
          method: 'ai-vision',
        };
      }
    } catch (error) {
      logger.error('AI fallback locator healing failed', error);
    }

    return { healed: false, newStrategy: '', newValue: '', confidence: 0, method: 'ai-vision' };
  }
}
