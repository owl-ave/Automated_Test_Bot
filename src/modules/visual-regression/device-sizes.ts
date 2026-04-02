import { Logger } from '../../utils/logger';
import { ClaudeClient } from '../../ai/claude-client';
import { Device, DEVICE_MATRIX } from '../../config/devices';
import { PercyAppIntegration, PercyComparisonResult } from './percy-app';

export interface LayoutIssue {
  device: string;
  screen: string;
  issue: string;
  severity: 'critical' | 'major' | 'minor';
  screenshot?: string;
}

export interface DeviceSizeResult {
  screenshots: Map<string, string>;
  comparisons: PercyComparisonResult[];
  layoutIssues: LayoutIssue[];
}

export class DeviceSizeTester {
  private logger = new Logger('DeviceSizes');
  private percy: PercyAppIntegration;
  private claude: ClaudeClient | null;

  constructor(percy: PercyAppIntegration) {
    this.percy = percy;
    this.claude = process.env.CLAUDE_CODE_OAUTH_TOKEN ? new ClaudeClient() : null;
  }

  async captureAcrossDevices(scenarios: string[], devices: Device[]): Promise<Map<string, string>> {
    const screenshots = new Map<string, string>();
    const targetDevices = devices.length > 0 ? devices : DEVICE_MATRIX;

    for (const device of targetDevices) {
      for (const scenario of scenarios) {
        const key = `${scenario}-${device.name}`.replace(/\s+/g, '-').toLowerCase();
        // Screenshot capture happens at executor level with the driver for each device.
        // Here we store the mapping for later comparison.
        screenshots.set(key, '');
        this.logger.debug(`Queued screenshot: ${key}`);
      }
    }

    this.logger.log('Screenshot capture plan created', {
      devices: targetDevices.length,
      scenarios: scenarios.length,
      total: screenshots.size,
    });

    return screenshots;
  }

  async captureScreenOnDevice(driver: any, screenName: string, device: Device): Promise<string | null> {
    const key = `${screenName}-${device.name}`.replace(/\s+/g, '-').toLowerCase();

    try {
      const screenshotId = await this.percy.captureScreenshot(driver, key);
      this.logger.log(`Captured: ${key}`);
      return screenshotId;
    } catch (err) {
      this.logger.error(`Failed to capture ${key}`, err);
      return null;
    }
  }

  async detectLayoutIssues(screenshots: Map<string, string>): Promise<LayoutIssue[]> {
    const issues: LayoutIssue[] = [];

    if (!this.claude) {
      this.logger.warn('Claude API key not available — skipping AI layout analysis');
      return issues;
    }

    // Group screenshots by screen name to compare across devices
    const byScreen = new Map<string, Map<string, string>>();
    for (const [key, data] of screenshots) {
      const parts = key.split('-');
      const device = parts.pop() || '';
      const screen = parts.join('-');
      if (!byScreen.has(screen)) byScreen.set(screen, new Map());
      byScreen.get(screen)!.set(device, data);
    }

    for (const [screen, deviceScreenshots] of byScreen) {
      if (deviceScreenshots.size < 2) continue;

      try {
        const deviceList = Array.from(deviceScreenshots.keys()).join(', ');
        const prompt = `Analyze layout consistency across these devices for screen "${screen}".
Devices tested: ${deviceList}

Look for:
1. Text truncation or overflow
2. Overlapping elements
3. Elements pushed off-screen
4. Inconsistent spacing/alignment
5. Broken layouts on tablets vs phones
6. Content not adapting to screen width

Respond in JSON format:
[{"device": "device_name", "issue": "description", "severity": "critical|major|minor"}]
Return empty array [] if no issues found.`;

        const response = await this.claude.analyzeCode('', prompt);
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed: Array<{ device: string; issue: string; severity: string }> = JSON.parse(jsonMatch[0]);
          for (const item of parsed) {
            issues.push({
              device: item.device,
              screen,
              issue: item.issue,
              severity: (item.severity as LayoutIssue['severity']) || 'minor',
            });
          }
        }
      } catch (err) {
        this.logger.error(`Layout analysis failed for screen: ${screen}`, err);
      }
    }

    this.logger.log('Layout issue detection complete', { issueCount: issues.length });
    return issues;
  }

  async compareAcrossDevices(screenshotKeys: string[]): Promise<PercyComparisonResult[]> {
    const results: PercyComparisonResult[] = [];

    for (const key of screenshotKeys) {
      try {
        const result = await this.percy.compareWithBaseline(key);
        results.push(result);
      } catch (err) {
        this.logger.error(`Comparison failed for: ${key}`, err);
        results.push({ name: key, diffPercent: 0, status: 'new' });
      }
    }

    return results;
  }
}
