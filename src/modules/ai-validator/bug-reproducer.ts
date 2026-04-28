import { query } from '@anthropic-ai/claude-agent-sdk';
import { TestResult } from '../../types';
import { Logger } from '../../utils/logger';

const logger = new Logger('BugReproducer');

export interface BugReport {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  steps: string[];
  rootCause: string;
  suggestedFix: string;
  affectedDevices: string[];
  screenshot?: string;
  logs: string;
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

export class BugReproducer {
  async reproduce(failure: TestResult, logs: string): Promise<BugReport> {
    logger.log('Generating bug report', { scenario: failure.scenario, device: failure.device });

    const prompt = `Analyze this mobile app test failure and generate a structured bug report.

Test Scenario: ${failure.scenario}
Device: ${failure.device}
Error: ${failure.error || 'No error message'}
Duration: ${failure.duration}ms

Appium/Device Logs (last 200 lines):
${logs.split('\n').slice(-200).join('\n')}

Respond with ONLY valid JSON (no markdown):
{
  "title": "Short descriptive bug title",
  "severity": "critical|high|medium|low",
  "steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
  "rootCause": "Analysis of why this failed",
  "suggestedFix": "Recommendation for fixing this issue"
}

Severity guide:
- critical: app crash, data loss, security issue
- high: core flow broken, feature unusable
- medium: feature partially broken, workaround exists
- low: cosmetic issue, minor UX problem`;

    try {
      const text = await askClaude(prompt);
      const parsed = this.parseResponse(text);

      return {
        ...parsed,
        affectedDevices: [failure.device],
        screenshot: failure.screenshot,
        logs: logs.split('\n').slice(-50).join('\n'),
      };
    } catch (error) {
      logger.error('Bug report generation failed', error);
      return this.fallbackReport(failure, logs);
    }
  }

  async reproduceMultiple(failures: TestResult[], logs: string): Promise<BugReport[]> {
    const grouped = this.groupByErrorSignature(failures);
    const reports: BugReport[] = [];

    for (const [, group] of grouped) {
      const representative = group[0];
      const report = await this.reproduce(representative, logs);
      report.affectedDevices = [...new Set(group.map((f) => f.device))];
      report.title =
        group.length > 1 ? `${report.title} (affects ${report.affectedDevices.length} devices)` : report.title;
      reports.push(report);
    }

    return reports;
  }

  private groupByErrorSignature(failures: TestResult[]): Map<string, TestResult[]> {
    const groups = new Map<string, TestResult[]>();

    for (const failure of failures) {
      const sig = this.errorSignature(failure.error || failure.scenario);
      const existing = groups.get(sig) || [];
      existing.push(failure);
      groups.set(sig, existing);
    }

    return groups;
  }

  private errorSignature(error: string): string {
    // Normalize volatile tokens without collapsing meaningful small integers.
    // Keeps short numbers (e.g. HTTP status codes, line numbers ≤ 4 digits) so
    // "timeout after 60000ms" and "timeout after 1000ms" don't collide.
    return error
      .replace(/0x[0-9a-f]+/gi, 'ADDR') // memory addresses
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
      .replace(/\b[0-9a-f]{16,}\b/gi, 'HEX') // long hex (hashes, tokens)
      .replace(/\b\d{10,}\b/g, 'TIMESTAMP') // epoch millis / ns
      .replace(/["'][^"']{20,}["']/g, 'STR') // only collapse long quoted strings
      .substring(0, 200)
      .trim();
  }

  private parseResponse(text: string): {
    title: string;
    severity: BugReport['severity'];
    steps: string[];
    rootCause: string;
    suggestedFix: string;
  } {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { safeJsonParse } = require('../../ai/parse-json') as typeof import('../../ai/parse-json');
    const parsed = safeJsonParse<{
      title?: string;
      severity?: string;
      steps?: string[];
      rootCause?: string;
      suggestedFix?: string;
    }>(text);

    if (parsed) {
      const validSeverities = ['critical', 'high', 'medium', 'low'] as const;
      const severity = (validSeverities as readonly string[]).includes(parsed.severity || '')
        ? (parsed.severity as BugReport['severity'])
        : 'medium';

      return {
        title: parsed.title || 'Untitled Bug',
        severity,
        steps: Array.isArray(parsed.steps) ? parsed.steps : ['No steps available'],
        rootCause: parsed.rootCause || 'Unable to determine root cause',
        suggestedFix: parsed.suggestedFix || 'Manual investigation required',
      };
    }

    logger.warn('Failed to parse bug report response (unparseable JSON from Claude)');
    return {
      title: 'Test Failure',
      severity: 'medium',
      steps: ['Automated analysis could not parse response'],
      rootCause: 'Unable to determine',
      suggestedFix: 'Manual investigation required',
    };
  }

  private fallbackReport(failure: TestResult, logs: string): BugReport {
    return {
      title: `Test failure: ${failure.scenario}`,
      severity: failure.error?.toLowerCase().includes('crash') ? 'critical' : 'medium',
      steps: [
        `1. Run scenario: ${failure.scenario}`,
        `2. Execute on device: ${failure.device}`,
        `3. Observe failure: ${failure.error || 'unknown error'}`,
      ],
      rootCause: failure.error || 'Unknown — manual investigation required',
      suggestedFix: 'Review the error details and device logs for more context',
      affectedDevices: [failure.device],
      screenshot: failure.screenshot,
      logs: logs.split('\n').slice(-50).join('\n'),
    };
  }
}
