import axios from 'axios';
import { Logger } from '../../utils/logger';

export interface PercyComparisonResult {
  name: string;
  diffPercent: number;
  status: 'match' | 'diff' | 'new';
  snapshotUrl?: string;
}

interface PercyBuild {
  id: string;
  webUrl: string;
  state: string;
}

export class PercyAppIntegration {
  private logger = new Logger('PercyApp');
  private token: string;
  private baseUrl = 'https://percy.io/api/v1';
  private buildId: string | null = null;
  private snapshots: Map<string, string> = new Map();

  constructor(percyToken?: string) {
    this.token = percyToken || process.env.PERCY_TOKEN || '';
    if (!this.token) {
      this.logger.warn('PERCY_TOKEN not set — visual regression will be skipped');
    }
  }

  async startBuild(projectSlug: string, commitSha: string, branch: string): Promise<string | null> {
    if (!this.token) return null;

    try {
      const response = await axios.post(
        `${this.baseUrl}/builds`,
        {
          data: {
            type: 'builds',
            attributes: {
              branch,
              'target-branch': 'main',
              'commit-sha': commitSha,
            },
            relationships: {
              project: { data: { type: 'projects', id: projectSlug } },
            },
          },
        },
        { headers: this.getHeaders() },
      );

      this.buildId = response.data.data.id;
      this.logger.log('Percy build started', { buildId: this.buildId });
      return this.buildId;
    } catch (err) {
      this.logger.error('Failed to start Percy build', err);
      return null;
    }
  }

  async captureScreenshot(driver: any, name: string): Promise<string | null> {
    try {
      const screenshot = await driver.takeScreenshot();
      const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');

      if (!this.token || !this.buildId) {
        // Store locally for offline comparison
        this.snapshots.set(name, base64Data);
        this.logger.log(`Screenshot captured locally: ${name}`);
        return base64Data;
      }

      const snapshotId = await this.uploadSnapshot(name, base64Data);
      if (snapshotId) {
        this.snapshots.set(name, snapshotId);
      }

      return snapshotId;
    } catch (err) {
      this.logger.error(`Failed to capture screenshot: ${name}`, err);
      return null;
    }
  }

  private async uploadSnapshot(name: string, base64Data: string): Promise<string | null> {
    try {
      // Create snapshot resource
      const resourceResponse = await axios.post(
        `${this.baseUrl}/builds/${this.buildId}/resources`,
        {
          data: {
            type: 'resources',
            attributes: {
              'resource-url': `/${name}.png`,
              'is-root': true,
              'mime-type': 'image/png',
              content: base64Data,
            },
          },
        },
        { headers: this.getHeaders() },
      );

      const resourceId = resourceResponse.data.data.id;

      // Create snapshot
      const snapshotResponse = await axios.post(
        `${this.baseUrl}/builds/${this.buildId}/snapshots`,
        {
          data: {
            type: 'snapshots',
            attributes: { name, 'enable-javascript': false },
            relationships: {
              resources: { data: [{ type: 'resources', id: resourceId }] },
            },
          },
        },
        { headers: this.getHeaders() },
      );

      const snapshotId = snapshotResponse.data.data.id;

      // Finalize snapshot
      await axios.post(`${this.baseUrl}/snapshots/${snapshotId}/finalize`, {}, { headers: this.getHeaders() });

      this.logger.log(`Snapshot uploaded: ${name}`, { snapshotId });
      return snapshotId;
    } catch (err) {
      this.logger.error(`Failed to upload snapshot: ${name}`, err);
      return null;
    }
  }

  async finalizeBuild(): Promise<void> {
    if (!this.token || !this.buildId) return;

    try {
      await axios.post(`${this.baseUrl}/builds/${this.buildId}/finalize`, {}, { headers: this.getHeaders() });
      this.logger.log('Percy build finalized');
    } catch (err) {
      this.logger.error('Failed to finalize Percy build', err);
    }
  }

  async compareWithBaseline(screenshotName: string): Promise<PercyComparisonResult> {
    if (!this.token || !this.buildId) {
      return { name: screenshotName, diffPercent: 0, status: 'new' };
    }

    try {
      // Poll build until processing is complete
      const build = await this.waitForBuild();
      if (!build) {
        return { name: screenshotName, diffPercent: 0, status: 'new' };
      }

      // Get snapshot comparisons
      const response = await axios.get(`${this.baseUrl}/builds/${this.buildId}/comparisons`, {
        headers: this.getHeaders(),
      });

      const comparisons = response.data.data || [];
      const match = comparisons.find((c: any) => c.attributes?.['head-snapshot-name'] === screenshotName);

      if (!match) {
        return { name: screenshotName, diffPercent: 0, status: 'new' };
      }

      const diffRatio = match.attributes?.['diff-ratio'] ?? 0;
      const diffPercent = diffRatio * 100;

      return {
        name: screenshotName,
        diffPercent,
        status: diffPercent === 0 ? 'match' : 'diff',
        snapshotUrl: match.links?.self,
      };
    } catch (err) {
      this.logger.error(`Failed to compare: ${screenshotName}`, err);
      return { name: screenshotName, diffPercent: 0, status: 'new' };
    }
  }

  private async waitForBuild(maxWaitMs = 120000): Promise<PercyBuild | null> {
    const start = Date.now();
    const pollInterval = 5000;

    while (Date.now() - start < maxWaitMs) {
      try {
        const response = await axios.get(`${this.baseUrl}/builds/${this.buildId}`, { headers: this.getHeaders() });

        const state = response.data.data.attributes.state;
        if (state === 'finished') {
          return {
            id: this.buildId!,
            webUrl: response.data.data.attributes['web-url'],
            state,
          };
        }
        if (state === 'failed') {
          this.logger.error('Percy build failed');
          return null;
        }
      } catch {
        /* retry */
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    this.logger.warn('Percy build timed out');
    return null;
  }

  private getHeaders() {
    return {
      Authorization: `Token ${this.token}`,
      'Content-Type': 'application/vnd.api+json',
    };
  }
}
