import axios from 'axios';
import { Logger } from '../../utils/logger';

export interface PercyComparisonResult {
  name: string;
  diffPercent: number;
  status: 'match' | 'diff' | 'new' | 'skipped';
  snapshotUrl?: string;
  error?: string;
}

interface PercyBuild {
  id: string;
  webUrl: string;
  state: string;
}

// Percy App SDK is invoked via `percy exec -- …` which runs a local Percy CLI proxy.
// When the proxy is up, percyScreenshot(driver, name) uploads the native screenshot
// with the correct device metadata automatically. We import it lazily so the bot can
// still run (skipping Percy) when the SDK is not installed or the CLI proxy is absent.
type PercyScreenshotFn = (driver: unknown, name: string, options?: Record<string, unknown>) => Promise<void>;

async function loadPercyScreenshot(): Promise<PercyScreenshotFn | null> {
  try {
    // Dynamic string avoids TS resolution of this optional dep at compile time.
    const sdkName = '@percy/appium-app';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(sdkName);
    const fn = mod?.percyScreenshot as PercyScreenshotFn | undefined;
    return typeof fn === 'function' ? fn : null;
  } catch {
    return null;
  }
}

export class PercyAppIntegration {
  private logger = new Logger('PercyApp');
  private token: string;
  private apiBaseUrl = 'https://percy.io/api/v1';
  private buildId: string | null = null;
  private snapshots: Map<string, string> = new Map();
  private cachedComparisons: any[] | null = null;
  private sdkWarned = false;

  constructor(percyToken?: string) {
    this.token = percyToken || process.env.PERCY_TOKEN || '';
    if (!this.token) {
      this.logger.warn('PERCY_TOKEN not set — visual regression will be skipped');
    }
  }

  // In the SDK-based flow the Percy CLI proxy manages builds — `percy exec -- node dist/index.js`
  // starts a build before our code runs and finalizes it after we exit. These helpers remain for
  // the comparison-query path against the Percy REST API.
  async startBuild(_projectSlug: string, _commitSha: string, _branch: string): Promise<string | null> {
    if (!this.token) return null;
    // If the CLI proxy is active, PERCY_BUILD_ID is exported to the child process.
    const envBuildId = process.env.PERCY_BUILD_ID || null;
    if (envBuildId) {
      this.buildId = envBuildId;
      this.logger.log('Using Percy build from CLI proxy', { buildId: this.buildId });
      return this.buildId;
    }
    this.logger.warn(
      'No PERCY_BUILD_ID in env. Run the bot via `percy exec -- node dist/index.js` so the Percy CLI creates a build.',
    );
    return null;
  }

  async captureScreenshot(driver: any, name: string): Promise<string | null> {
    if (!this.token) {
      return null;
    }

    const percyScreenshot = await loadPercyScreenshot();
    if (!percyScreenshot) {
      if (!this.sdkWarned) {
        this.logger.warn(
          '@percy/appium-app not installed — install it and run via `percy exec -- …` to enable visual regression',
        );
        this.sdkWarned = true;
      }
      return null;
    }

    try {
      await percyScreenshot(driver, name);
      // The SDK does not return a snapshot id synchronously; we track the name locally.
      this.snapshots.set(name, name);
      this.logger.log(`Percy screenshot captured: ${name}`);
      return name;
    } catch (err) {
      this.logger.error(`Failed to capture Percy screenshot: ${name}`, err);
      return null;
    }
  }

  // Percy CLI proxy finalizes the build on its own when the wrapped process exits.
  // This is a no-op kept for API compatibility.
  async finalizeBuild(): Promise<void> {
    if (!this.token || !this.buildId) return;
    this.logger.log('finalizeBuild(): no-op — Percy CLI finalizes build on process exit');
  }

  async compareWithBaseline(screenshotName: string): Promise<PercyComparisonResult> {
    if (!this.token || !this.buildId) {
      return { name: screenshotName, diffPercent: 0, status: 'skipped' };
    }

    try {
      if (!this.cachedComparisons) {
        const response = await axios.get(`${this.apiBaseUrl}/builds/${this.buildId}/comparisons`, {
          headers: this.getHeaders(),
        });
        this.cachedComparisons = response.data.data || [];
      }

      const match = this.cachedComparisons!.find(
        (c: any) => c.attributes?.['head-snapshot-name'] === screenshotName,
      );

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
      return {
        name: screenshotName,
        diffPercent: 0,
        status: 'skipped',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async waitForBuildOnce(maxWaitMs = 120000): Promise<PercyBuild | null> {
    if (!this.buildId) return null;
    const start = Date.now();
    const pollInterval = 5000;

    while (Date.now() - start < maxWaitMs) {
      try {
        const response = await axios.get(`${this.apiBaseUrl}/builds/${this.buildId}`, {
          headers: this.getHeaders(),
        });

        const state = response.data.data.attributes.state;
        if (state === 'finished') {
          return {
            id: this.buildId,
            webUrl: response.data.data.attributes['web-url'],
            state,
          };
        }
        if (state === 'failed') {
          this.logger.error('Percy build failed');
          return null;
        }
      } catch (err) {
        this.logger.debug('Percy build poll failed, retrying', { error: String(err) });
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
