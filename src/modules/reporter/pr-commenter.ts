import { PipelineContext, TestResult, ModuleStatus } from '../../types';
import { GitHubClient } from '../../utils/github';
import { Logger } from '../../utils/logger';

interface ReportSection {
  title: string;
  content: string;
}

export class PrCommenter {
  private github: GitHubClient;
  private logger = new Logger('PrCommenter');

  constructor(githubClient: GitHubClient) {
    this.github = githubClient;
  }

  generateReport(context: PipelineContext): string {
    const results = context.testResults || [];
    const passed = results.filter((r) => r.status === 'pass');
    const failed = results.filter((r) => r.status === 'fail');
    const warned = results.filter((r) => r.status === 'warn');
    const moduleStatuses = context.moduleStatuses || [];

    const sections: ReportSection[] = [];

    // Test environment — framework, platform, devices, build info
    sections.push({
      title: 'Test Environment',
      content: this.buildEnvironmentSection(context),
    });

    // Pipeline execution summary — always show what actually happened
    sections.push({
      title: 'Pipeline Execution',
      content: this.buildPipelineSection(moduleStatuses, results.length > 0),
    });

    // If no real tests ran, show a clear warning instead of fake results
    if (results.length === 0) {
      sections.push({
        title: 'Test Results',
        content: '> **No tests were executed on real devices.** The pipeline completed code analysis only.\n>\n> Check the Pipeline Execution table above to see which modules failed or were skipped.',
      });
      return this.assembleReport(sections);
    }

    sections.push({
      title: 'Summary',
      content: this.buildSummaryTable(passed.length, failed.length, warned.length, results),
    });

    if (failed.length > 0) {
      sections.push({
        title: 'Failed Tests',
        content: this.buildFailedSection(failed),
      });
    }

    if (warned.length > 0) {
      sections.push({
        title: 'Warnings',
        content: this.buildWarningsSection(warned),
      });
    }

    const perfData = context.logs.filter((l) => l.startsWith('[perf]'));
    if (perfData.length > 0) {
      sections.push({
        title: 'Performance Metrics',
        content: perfData.map((l) => `- ${l.replace('[perf] ', '')}`).join('\n'),
      });
    }

    if (passed.length > 0) {
      sections.push({
        title: 'Passing Tests',
        content: this.buildPassingSection(passed),
      });
    }

    return this.assembleReport(sections);
  }

  private buildEnvironmentSection(context: PipelineContext): string {
    const lines: string[] = [];
    const framework = context.codeAnalysis?.framework || 'unknown';
    const frameworkLabel: Record<string, string> = {
      'react-native': 'React Native',
      flutter: 'Flutter',
      swift: 'iOS Native (Swift)',
      kotlin: 'Android Native (Kotlin)',
      native: 'Native',
    };

    lines.push(`| Property | Value |`);
    lines.push(`|----------|-------|`);
    lines.push(`| **Framework** | ${frameworkLabel[framework] || framework} |`);

    if (context.codeAnalysis) {
      const subFw = (context.codeAnalysis as any).subFramework;
      if (subFw) lines.push(`| **UI Framework** | ${subFw} |`);
    }

    // Platforms tested
    const platforms: string[] = [];
    if (context.appBuild?.androidAppUrl) platforms.push('Android');
    if (context.appBuild?.iosAppUrl) platforms.push('iOS');
    if (platforms.length > 0) lines.push(`| **Platforms** | ${platforms.join(', ')} |`);

    // Build artifacts
    if (context.appBuild?.androidAppUrl) {
      lines.push(`| **Android Build** | \`${context.appBuild.androidCustomId || 'uploaded'}\` |`);
    }
    if (context.appBuild?.iosAppUrl) {
      lines.push(`| **iOS Build** | \`${context.appBuild.iosCustomId || 'uploaded'}\` |`);
    }

    // Devices tested
    const results = context.testResults || [];
    const devices = [...new Set(results.map((r) => r.device))];
    if (devices.length > 0) lines.push(`| **Devices** | ${devices.join(', ')} |`);

    // Total pipeline time
    const totalMs = (context.moduleStatuses || []).reduce((sum, m) => sum + m.durationMs, 0);
    if (totalMs > 0) {
      const totalSec = (totalMs / 1000).toFixed(1);
      lines.push(`| **Pipeline Duration** | ${totalSec}s |`);
    }

    lines.push(`| **Branch** | \`${context.branch}\` |`);

    return lines.join('\n');
  }

  private buildPipelineSection(statuses: ModuleStatus[], hasTestResults: boolean): string {
    if (statuses.length === 0) {
      return '*No module execution data available.*';
    }

    const statusIcon = (s: ModuleStatus['status']) => {
      switch (s) {
        case 'success': return '✅';
        case 'warning': return '⚠️';
        case 'error': return '❌';
        case 'skipped': return '⏭️';
      }
    };

    const rows = statuses.map((m) => {
      const duration = m.durationMs > 0 ? `${(m.durationMs / 1000).toFixed(1)}s` : '-';
      const reason = m.error ? m.error : '';
      return `| ${statusIcon(m.status)} | ${m.name} | ${m.status.toUpperCase()} | ${duration} | ${reason} |`;
    }).join('\n');

    const lines = [
      '| | Module | Status | Duration | Details |',
      '|---|--------|--------|----------|---------|',
      rows,
    ];

    // Add a warning banner if critical modules failed/skipped
    const skippedOrFailed = statuses.filter((m) => m.status === 'error' || m.status === 'skipped');
    const browserStackSkipped = skippedOrFailed.some((m) => m.name === 'BrowserStack');

    if (browserStackSkipped && !hasTestResults) {
      lines.push('');
      lines.push('> ⚠️ **BrowserStack was skipped** — no real device tests were executed. Results below (if any) are from code analysis only and do not reflect actual app behavior.');
    }

    return lines.join('\n');
  }

  private buildSummaryTable(pass: number, fail: number, warn: number, results: TestResult[]): string {
    const total = pass + fail + warn;
    const avgDuration = total > 0 ? (results.reduce((sum, r) => sum + r.duration, 0) / total / 1000).toFixed(1) : '0';
    const statusIcon = fail > 0 ? '🔴' : warn > 0 ? '🟡' : '🟢';
    const devices = [...new Set(results.map((r) => r.device))];

    return [
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Status | ${statusIcon} ${fail > 0 ? 'FAILED' : warn > 0 ? 'WARNING' : 'PASSED'} |`,
      `| Total Tests | ${total} |`,
      `| Passed | ${pass} |`,
      `| Failed | ${fail} |`,
      `| Warnings | ${warn} |`,
      `| Avg Duration | ${avgDuration}s |`,
      `| Devices | ${devices.join(', ') || 'N/A'} |`,
    ].join('\n');
  }

  private buildFailedSection(failed: TestResult[]): string {
    // Show first 10 failures inline, rest collapsed to keep comment size manageable
    const MAX_INLINE = 10;
    const inline = failed.slice(0, MAX_INLINE);
    const overflow = failed.slice(MAX_INLINE);

    const renderEntry = (t: TestResult) => {
      const lines = [
        `#### ${t.scenario}`,
        `- **Device**: ${t.device}`,
        `- **Duration**: ${(t.duration / 1000).toFixed(1)}s`,
        `- **Error**: \`${t.error || 'Unknown error'}\``,
      ];
      if (t.screenshot && t.screenshot.startsWith('http')) {
        lines.push(`- **Screenshot**: [View Screenshot](${t.screenshot})`);
      }
      if (t.videoUrl) {
        lines.push(`- **Video**: [Watch Test Recording](${t.videoUrl})`);
      }
      if (t.sessionId) {
        lines.push(`- **Session**: [View on BrowserStack](https://app-automate.browserstack.com/sessions/${t.sessionId})`);
      }
      return lines.join('\n');
    };

    const parts: string[] = [inline.map(renderEntry).join('\n\n---\n\n')];

    if (overflow.length > 0) {
      const overflowRows = overflow.map((t) => {
        const session = t.sessionId ? `[Session](https://app-automate.browserstack.com/sessions/${t.sessionId})` : '-';
        const video = t.videoUrl ? `[Video](${t.videoUrl})` : '-';
        return `| ${t.scenario} | ${t.device} | ${t.error?.slice(0, 80) || 'Unknown'} | ${session} | ${video} |`;
      }).join('\n');

      parts.push([
        '',
        `<details>`,
        `<summary>+${overflow.length} more failures</summary>`,
        '',
        '| Scenario | Device | Error | Session | Video |',
        '|----------|--------|-------|---------|-------|',
        overflowRows,
        '',
        '</details>',
      ].join('\n'));
    }

    return parts.join('\n');
  }

  private buildWarningsSection(warned: TestResult[]): string {
    return warned
      .map((t) => {
        const video = t.videoUrl ? ` | [Watch Video](${t.videoUrl})` : '';
        return `- **${t.scenario}** on ${t.device}: ${t.error || 'Non-critical issue detected'}${video}`;
      })
      .join('\n');
  }

  private buildPassingSection(passed: TestResult[]): string {
    const rows = passed
      .map((t) => {
        const video = t.videoUrl ? `[Watch](${t.videoUrl})` : '-';
        const session = t.sessionId ? `[Session](https://app-automate.browserstack.com/sessions/${t.sessionId})` : '-';
        return `| ${t.scenario} | ${t.device} | ${(t.duration / 1000).toFixed(1)}s | ${video} | ${session} |`;
      })
      .join('\n');

    return [
      '<details>',
      '<summary>View passing tests</summary>',
      '',
      '| Scenario | Device | Duration | Video | Session |',
      '|----------|--------|----------|-------|---------|',
      rows,
      '',
      '</details>',
    ].join('\n');
  }

  private assembleReport(sections: ReportSection[]): string {
    const header = '## Automated Testing Bot Report\n';
    const body = sections.map((s) => `### ${s.title}\n\n${s.content}`).join('\n\n');
    const footer = '\n\n---\n*Generated by Automated Testing Bot*';
    return header + '\n' + body + footer;
  }

  async postReport(owner: string, repo: string, prNumber: number, report: string): Promise<void> {
    const GITHUB_COMMENT_LIMIT = 65000; // GitHub hard limit is 65536, keep buffer
    let body = report;

    if (body.length > GITHUB_COMMENT_LIMIT) {
      const truncationNote = '\n\n---\n> ⚠️ Report truncated — full details in [workflow logs](https://github.com/' + owner + '/' + repo + '/actions).';
      body = body.slice(0, GITHUB_COMMENT_LIMIT - truncationNote.length) + truncationNote;
      this.logger.warn('Report truncated to fit GitHub comment limit', { originalLength: report.length });
    }

    try {
      await this.github.postComment(owner, repo, prNumber, body);
      this.logger.log('Report posted to PR', { prNumber, length: body.length });
    } catch (err) {
      this.logger.error('Failed to post report', err);
      throw err;
    }
  }
}
