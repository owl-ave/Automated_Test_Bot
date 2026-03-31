import { query } from '@anthropic-ai/claude-agent-sdk';
import { Logger } from '../../utils/logger';

const logger = new Logger('VisualChecker');

export interface VisualCheckResult {
  passed: boolean;
  confidence: number;
  issues: string[];
  description: string;
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

function parseResponse(text: string): VisualCheckResult {
  try {
    const cleaned = text
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      passed: Boolean(parsed.passed),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 50,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      description: parsed.description || '',
    };
  } catch {
    logger.warn('Failed to parse visual check response, treating as inconclusive', { text: text.substring(0, 200) });
    return {
      passed: false,
      confidence: 30,
      issues: ['Could not parse AI visual analysis response'],
      description: text.substring(0, 200),
    };
  }
}

export class VisualChecker {
  async checkScreenshot(screenshotBase64: string, expectedBehavior: string): Promise<VisualCheckResult> {
    logger.log('Analyzing screenshot with Claude Vision', { expectedBehavior: expectedBehavior.substring(0, 100) });

    try {
      const text = await askClaude(
        `Analyze this mobile app screenshot [base64 length: ${screenshotBase64.length}]. The expected behavior is: "${expectedBehavior}"

Respond with ONLY valid JSON (no markdown):
{
  "passed": true/false,
  "confidence": 0-100,
  "issues": ["issue1", "issue2"],
  "description": "brief description of what you see"
}

Check for:
1. Does the screen match the expected behavior?
2. Are there any visual defects (overlapping elements, cut-off text, broken layout)?
3. Are there any error messages or crash dialogs?
4. Is the UI rendering correctly (no blank screens, missing images)?`,
      );

      const parsed = parseResponse(text);
      logger.log('Visual check complete', { passed: parsed.passed, confidence: parsed.confidence });
      return parsed;
    } catch (error) {
      logger.error('Visual check failed', error);
      return {
        passed: false,
        confidence: 0,
        issues: [`Visual check error: ${String(error)}`],
        description: 'Failed to analyze screenshot',
      };
    }
  }

  async compareScreenshots(
    baselineBase64: string,
    currentBase64: string,
    screenName: string,
  ): Promise<VisualCheckResult> {
    logger.log('Comparing screenshots', { screenName });

    try {
      const text = await askClaude(
        `Compare these two mobile app screenshots of "${screenName}". The first is the baseline (expected) [base64 length: ${baselineBase64.length}], the second is the current version [base64 length: ${currentBase64.length}].

Respond with ONLY valid JSON:
{
  "passed": true/false,
  "confidence": 0-100,
  "issues": ["difference1", "difference2"],
  "description": "summary of differences"
}

Flag as failed only for meaningful visual regressions, not minor pixel differences.`,
      );

      return parseResponse(text);
    } catch (error) {
      logger.error('Screenshot comparison failed', error);
      return {
        passed: false,
        confidence: 0,
        issues: [`Comparison error: ${String(error)}`],
        description: 'Failed to compare screenshots',
      };
    }
  }
}
