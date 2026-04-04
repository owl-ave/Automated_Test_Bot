import { query } from '@anthropic-ai/claude-agent-sdk';
import { Logger } from '../../utils/logger';

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

export class LocatorHealer {
  async healLocator(originalLocator: LocatorStrategy, pageSource: string, platform?: 'android' | 'ios'): Promise<HealResult> {
    logger.log('Healing broken locator', { strategy: originalLocator.strategy, value: originalLocator.value, platform });

    // Platform-aware strategies in order of reliability
    const strategies = platform === 'ios'
      ? [
          () => this.tryAccessibilityId(originalLocator, pageSource),
          () => this.tryTextMatch(originalLocator, pageSource),
          () => this.tryXPath(originalLocator, pageSource),
          () => this.tryAiFallback(originalLocator, pageSource),
        ]
      : [
          () => this.tryAccessibilityId(originalLocator, pageSource),
          () => this.tryResourceId(originalLocator, pageSource),
          () => this.tryTextMatch(originalLocator, pageSource),
          () => this.tryXPath(originalLocator, pageSource),
          () => this.tryAiFallback(originalLocator, pageSource),
        ];

    for (const strategy of strategies) {
      const result = await strategy();
      if (result.healed) {
        logger.log('Locator healed', {
          method: result.method,
          newStrategy: result.newStrategy,
          newValue: result.newValue,
        });
        return result;
      }
    }

    logger.warn('Could not heal locator', { original: originalLocator });
    return {
      healed: false,
      newStrategy: originalLocator.strategy,
      newValue: originalLocator.value,
      confidence: 0,
      method: 'none',
    };
  }

  private tryAccessibilityId(original: LocatorStrategy, pageSource: string): HealResult {
    const accessibilityIds = this.extractAttributes(pageSource, ['content-desc', 'accessibility-id', 'label', 'name']);

    const match = this.findBestMatch(original.value, accessibilityIds);
    if (match && match.score >= 0.6) {
      return {
        healed: true,
        newStrategy: 'accessibility id',
        newValue: match.value,
        confidence: Math.round(match.score * 100),
        method: 'accessibility-id',
      };
    }

    return { healed: false, newStrategy: '', newValue: '', confidence: 0, method: 'accessibility-id' };
  }

  private tryResourceId(original: LocatorStrategy, pageSource: string): HealResult {
    const resourceIds = this.extractAttributes(pageSource, ['resource-id', 'id']);
    const match = this.findBestMatch(original.value, resourceIds);

    if (match && match.score >= 0.6) {
      return {
        healed: true,
        newStrategy: 'id',
        newValue: match.value,
        confidence: Math.round(match.score * 100),
        method: 'resource-id',
      };
    }

    return { healed: false, newStrategy: '', newValue: '', confidence: 0, method: 'resource-id' };
  }

  private tryTextMatch(original: LocatorStrategy, pageSource: string): HealResult {
    const texts = this.extractAttributes(pageSource, ['text', 'value', 'label']);
    const match = this.findBestMatch(original.value, texts);

    if (match && match.score >= 0.7) {
      const xpath = `//*[contains(@text,"${this.escapeXPath(match.value)}") or contains(@label,"${this.escapeXPath(match.value)}")]`;
      return {
        healed: true,
        newStrategy: 'xpath',
        newValue: xpath,
        confidence: Math.round(match.score * 100),
        method: 'text-match',
      };
    }

    return { healed: false, newStrategy: '', newValue: '', confidence: 0, method: 'text-match' };
  }

  private tryXPath(original: LocatorStrategy, pageSource: string): HealResult {
    const originalName = this.extractElementName(original.value);
    if (!originalName) {
      return { healed: false, newStrategy: '', newValue: '', confidence: 0, method: 'xpath' };
    }

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
        const xpath = `//${uiType}[contains(@text,"${this.escapeXPath(originalName)}") or contains(@content-desc,"${this.escapeXPath(originalName)}") or contains(@label,"${this.escapeXPath(originalName)}")]`;
        if (this.xpathExistsInSource(xpath, originalName, pageSource)) {
          return {
            healed: true,
            newStrategy: 'xpath',
            newValue: xpath,
            confidence: 60,
            method: 'xpath-class',
          };
        }
      }
    }

    return { healed: false, newStrategy: '', newValue: '', confidence: 0, method: 'xpath' };
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
        return {
          healed: true,
          newStrategy: parsed.strategy,
          newValue: parsed.value,
          confidence: parsed.confidence || 50,
          method: 'ai-vision',
        };
      }
    } catch (error) {
      logger.error('AI fallback locator healing failed', error);
    }

    return { healed: false, newStrategy: '', newValue: '', confidence: 0, method: 'ai-vision' };
  }

  private extractAttributes(pageSource: string, attrNames: string[]): string[] {
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

  private findBestMatch(target: string, candidates: string[]): { value: string; score: number } | null {
    if (candidates.length === 0) return null;

    const normalizedTarget = target.toLowerCase().replace(/[^a-z0-9]/g, '');
    let bestMatch = { value: '', score: 0 };

    for (const candidate of candidates) {
      const normalizedCandidate = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)) {
        const score =
          Math.min(normalizedTarget.length, normalizedCandidate.length) /
          Math.max(normalizedTarget.length, normalizedCandidate.length);
        if (score > bestMatch.score) {
          bestMatch = { value: candidate, score: Math.max(score, 0.8) };
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

  private extractElementName(locatorValue: string): string {
    const idMatch = locatorValue.match(/(?:id\/|:id\/)([^"'\]]+)/);
    if (idMatch) return idMatch[1];

    const textMatch = locatorValue.match(/(?:text|content-desc|label).*?["']([^"']+)["']/);
    if (textMatch) return textMatch[1];

    return locatorValue;
  }

  private escapeXPath(value: string): string {
    return value.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  private xpathExistsInSource(xpath: string, searchTerm: string, pageSource: string): boolean {
    return pageSource.toLowerCase().includes(searchTerm.toLowerCase());
  }
}
