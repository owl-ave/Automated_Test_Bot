import { Logger } from '../utils/logger';

// IMPORTANT: This project uses ONLY the Claude Agent SDK (@anthropic-ai/claude-agent-sdk).
// The Agent SDK does NOT accept image inputs — it is text-only. We intentionally do NOT
// depend on @anthropic-ai/sdk (Messages API) here.
//
// As a result, the "vision" methods below cannot perform real image analysis. Instead of
// faking a pass (which hid real failures in the old code), each method now returns an
// explicit "skipped" / "unsupported" shape and logs clearly. Callers should treat the
// result as "visual validation unavailable" and fall back to screenshot links in the PR
// comment + BrowserStack session recording for manual review.

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

export class VisionAnalyzer {
  private warned = false;

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    logger.warn(
      'Vision analysis is unavailable: Claude Agent SDK is text-only. Visual checks will be ' +
        'skipped and the PR comment will include a link to the BrowserStack session for manual review.',
    );
  }

  // Returns an empty string rather than a fabricated description. Callers should
  // check for truthiness before including this in any report.
  async analyzeScreenshot(_imageBase64: string, _question: string): Promise<string> {
    this.warnOnce();
    return '';
  }

  // Returns an empty array — we cannot enumerate UI elements from pixels via the Agent SDK.
  async detectElements(_imageBase64: string): Promise<DetectedElement[]> {
    this.warnOnce();
    return [];
  }

  // Returns a neutral "skipped" shape so downstream code does NOT treat a missing
  // visual diff as a pass. `match: false` + `confidence: 0` signals to the validator
  // that this check didn't run, and it should not count toward a green build.
  async compareScreenshots(
    _baselineBase64: string,
    _currentBase64: string,
    _context: string,
  ): Promise<{ match: boolean; differences: string[]; confidence: number }> {
    this.warnOnce();
    return {
      match: false,
      differences: ['vision-unsupported: Agent SDK is text-only, screenshot comparison skipped'],
      confidence: 0,
    };
  }

  async validateScreenState(
    _imageBase64: string,
    _expectedState: string,
    _platform: 'android' | 'ios',
  ): Promise<{ valid: boolean; confidence: number; issues: string[] }> {
    this.warnOnce();
    return {
      valid: false,
      confidence: 0,
      issues: ['vision-unsupported: Agent SDK is text-only, screen state validation skipped'],
    };
  }
}
