import { query } from '@anthropic-ai/claude-agent-sdk';
import { Logger } from '../utils/logger';

export interface VisionAnalysisResult {
  description: string;
  elements: DetectedElement[];
  issues: string[];
}

export interface DetectedElement {
  type: string;
  text?: string;
  location: string;
  interactable: boolean;
}

const logger = new Logger('VisionAnalyzer');

async function runVisionQuery(prompt: string): Promise<string> {
  let result = '';
  for await (const message of query({
    prompt,
    options: {
      maxTurns: 1,
      model: 'claude-opus-4-6',
    },
  })) {
    if ('result' in message) {
      result = message.result;
    }
  }
  return result;
}

function parseJSON(text: string): unknown {
  const cleaned = text
    .replace(/```json?\n?/g, '')
    .replace(/```/g, '')
    .trim();
  return JSON.parse(cleaned);
}

export class VisionAnalyzer {
  constructor() {
    // Agent SDK uses CLAUDE_AUTH_TOKEN from environment automatically
  }

  async analyzeScreenshot(imageBase64: string, question: string): Promise<string> {
    try {
      const response = await runVisionQuery(
        `[Screenshot provided as base64 image data, length: ${imageBase64.length} chars]\n\n${question}`,
      );
      logger.log('Screenshot analyzed', { responseLength: response.length });
      return response;
    } catch (error) {
      logger.error('Screenshot analysis failed', error);
      throw error;
    }
  }

  async detectElements(imageBase64: string): Promise<DetectedElement[]> {
    const prompt = `Analyze this mobile app screenshot and list all visible UI elements.

For each element provide:
- type: button, text, input, image, icon, toggle, checkbox, radio, slider, tab, list-item, header, navigation, modal, toast, etc.
- text: any visible text on or near the element
- location: approximate position (top-left, top-center, top-right, center-left, center, center-right, bottom-left, bottom-center, bottom-right)
- interactable: true if the element can be tapped/clicked/interacted with

Respond with JSON only (no markdown fences):
[
  {"type": "button", "text": "Login", "location": "center", "interactable": true}
]`;

    const response = await this.analyzeScreenshot(imageBase64, prompt);

    try {
      const parsed = parseJSON(response);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      logger.warn('Failed to parse element detection response as JSON');
      return [];
    }
  }

  async compareScreenshots(
    baselineBase64: string,
    currentBase64: string,
    context: string,
  ): Promise<{ match: boolean; differences: string[]; confidence: number }> {
    try {
      const response = await runVisionQuery(
        `Compare these two mobile app screenshots. Context: ${context}

First image is the baseline (expected) [base64 length: ${baselineBase64.length}], second is current (actual) [base64 length: ${currentBase64.length}].

Respond with JSON only (no markdown fences):
{
  "match": <boolean - true if screens are functionally equivalent>,
  "differences": ["<list each visual difference>"],
  "confidence": <0-100>,
  "severity": "none" | "cosmetic" | "functional" | "critical"
}

Ignore: minor font rendering, platform styling, exact pixel positions.
Flag: missing elements, broken layout, wrong text, crash screens.`,
      );

      const result = parseJSON(response) as { match?: boolean; differences?: string[]; confidence?: number };
      return {
        match: result.match ?? false,
        differences: result.differences ?? [],
        confidence: result.confidence ?? 0,
      };
    } catch (error) {
      logger.error('Screenshot comparison failed', error);
      return { match: false, differences: ['Comparison failed due to error'], confidence: 0 };
    }
  }

  async validateScreenState(
    imageBase64: string,
    expectedState: string,
    platform: 'android' | 'ios',
  ): Promise<{ valid: boolean; confidence: number; issues: string[] }> {
    const prompt = `Analyze this ${platform} mobile app screenshot and determine if it matches the expected state.

Expected state: ${expectedState}

Respond with JSON only (no markdown fences):
{
  "valid": <boolean>,
  "confidence": <0-100>,
  "issues": ["<any issues found>"],
  "screenType": "<what type of screen this appears to be>",
  "visibleText": ["<key text visible on screen>"]
}

Check for:
1. Is the correct screen displayed?
2. Are expected elements visible?
3. Is there any error state, crash, or ANR dialog?
4. Is a loading spinner stuck?
5. Is the layout properly rendered (no overlapping, no truncation)?`;

    const response = await this.analyzeScreenshot(imageBase64, prompt);

    try {
      const parsed = parseJSON(response) as { valid?: boolean; confidence?: number; issues?: string[] };
      return {
        valid: parsed.valid ?? false,
        confidence: parsed.confidence ?? 0,
        issues: parsed.issues ?? [],
      };
    } catch {
      logger.warn('Failed to parse validation response');
      return { valid: false, confidence: 0, issues: ['Failed to parse AI response'] };
    }
  }
}
