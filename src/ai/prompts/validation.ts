export function getValidationPrompt(expected: string, actual: string): string {
  return `You are a mobile app QA validator. Compare the expected behavior with the actual result and determine the test outcome.

Expected behavior:
${expected}

Actual result:
${actual}

Evaluate and respond with JSON only (no markdown fences):
{
  "status": "pass" | "fail" | "warn",
  "confidence": <number 0-100>,
  "reason": "<concise explanation>",
  "details": {
    "matchedExpectations": ["<what matched>"],
    "unmatchedExpectations": ["<what did not match>"],
    "unexpectedBehavior": ["<anything unexpected found>"]
  }
}

Rules:
- "pass": Actual matches expected behavior (confidence >= 80)
- "warn": Partial match or minor cosmetic differences (confidence 40-79)
- "fail": Actual does not match expected, or a functional issue exists (confidence < 40)
- Consider mobile-specific factors: loading states, animation delays, platform UI differences
- Ignore minor differences in font rendering, exact pixel positions, or platform-specific styling
- Flag any crash indicators, ANR, or unresponsive UI as automatic "fail"`;
}

export function getScreenshotValidationPrompt(
  expectedBehavior: string,
  stepDescription: string,
  platform: 'android' | 'ios',
): string {
  return `Analyze this ${platform} mobile app screenshot taken during automated testing.

Test step: ${stepDescription}
Expected behavior: ${expectedBehavior}

Evaluate the screenshot and respond with JSON only (no markdown fences):
{
  "status": "pass" | "fail" | "warn",
  "confidence": <number 0-100>,
  "reason": "<concise explanation>",
  "elementsFound": ["<UI elements visible in screenshot>"],
  "issues": ["<any visual or functional issues detected>"],
  "suggestions": ["<improvement suggestions if any>"]
}

Check for:
1. Expected UI elements are visible and properly rendered
2. Text is readable and not truncated
3. No error dialogs, crash screens, or ANR popups
4. Layout is not broken (no overlapping elements, proper alignment)
5. Loading indicators are not stuck
6. Correct screen is displayed for the test step
7. Platform-specific UI conventions are followed`;
}

export function getBatchValidationPrompt(
  testResults: { scenario: string; expected: string; actual: string }[],
): string {
  const resultsBlock = testResults
    .map((r, i) => `Test ${i + 1}: ${r.scenario}\nExpected: ${r.expected}\nActual: ${r.actual}`)
    .join('\n\n---\n\n');

  return `Validate these ${testResults.length} mobile test results. For each, determine pass/fail/warn.

${resultsBlock}

Respond with a JSON array (no markdown fences):
[
  {
    "testIndex": <number>,
    "status": "pass" | "fail" | "warn",
    "confidence": <number 0-100>,
    "reason": "<concise explanation>"
  }
]

Prioritize functional correctness over cosmetic differences.`;
}
