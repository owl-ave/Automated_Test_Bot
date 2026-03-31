export function getBugReportPrompt(error: string, logs: string, steps: string[]): string {
  const stepsFormatted = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');

  return `Generate a detailed mobile app bug report from this test failure.

Error:
${error}

Logs:
${logs}

Steps that were executed:
${stepsFormatted}

Generate a structured bug report as JSON (no markdown fences):
{
  "title": "<concise bug title>",
  "severity": "critical" | "major" | "minor" | "trivial",
  "category": "crash" | "functional" | "ui" | "performance" | "security" | "accessibility",
  "environment": {
    "suggestedDevice": "<device if inferable from logs>",
    "suggestedOS": "<OS version if inferable>"
  },
  "stepsToReproduce": [
    "<step 1>",
    "<step 2>"
  ],
  "expectedResult": "<what should happen>",
  "actualResult": "<what actually happened>",
  "rootCauseHypothesis": "<best guess at what caused the bug>",
  "suggestedFix": "<suggested code-level fix if possible>",
  "relatedScreens": ["<screens involved>"],
  "additionalContext": "<any other relevant info from logs>"
}

Rules:
- Severity: "critical" = crash/data loss/security, "major" = feature broken, "minor" = degraded UX, "trivial" = cosmetic
- Steps should be minimal but complete for reproduction
- Root cause should reference specific error patterns from logs
- If logs contain a stack trace, identify the failing component/module`;
}

export function getMinimalReproPrompt(fullSteps: string[], error: string, passedSteps: number): string {
  const stepsFormatted = fullSteps
    .map((s, i) => {
      const marker = i < passedSteps ? '[PASSED]' : i === passedSteps ? '[FAILED]' : '[SKIPPED]';
      return `${marker} ${i + 1}. ${s}`;
    })
    .join('\n');

  return `Given this test execution where step ${passedSteps + 1} failed, determine the minimal reproduction steps.

Full execution:
${stepsFormatted}

Error at step ${passedSteps + 1}:
${error}

Respond with JSON (no markdown fences):
{
  "minimalSteps": [
    "<only the essential steps needed to reproduce>"
  ],
  "preconditions": ["<required app state before reproduction>"],
  "canSkip": ["<steps from original that are not needed for repro>"],
  "isIntermittent": <boolean>,
  "intermittentConfidence": <number 0-100 if intermittent>
}

Rules:
- Remove steps that don't contribute to reaching the failure state
- Keep authentication/setup steps if the bug requires them
- If the failure is likely timing-related, mark isIntermittent as true`;
}

export function getCrashAnalysisPrompt(stackTrace: string, deviceInfo: string): string {
  return `Analyze this mobile app crash from automated testing.

Stack trace:
${stackTrace}

Device info:
${deviceInfo}

Respond with JSON (no markdown fences):
{
  "crashType": "NullPointerException" | "ArrayIndexOutOfBounds" | "SegmentationFault" | "OutOfMemory" | "ANR" | "other",
  "faultingComponent": "<class/file where crash originates>",
  "faultingMethod": "<method name>",
  "triggerCondition": "<what likely triggered the crash>",
  "isDeviceSpecific": <boolean>,
  "isOsVersionSpecific": <boolean>,
  "suggestedFix": "<code-level fix suggestion>",
  "workaround": "<temporary workaround if possible>"
}`;
}
