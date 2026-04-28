import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jwt = require('jsonwebtoken');
import { Logger } from './logger';

const logger = new Logger('GitHubClient');

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let delayMs = 500;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status;
      const retriable = !status || status === 429 || (status >= 500 && status < 600);
      if (i === attempts || !retriable) throw error;
      logger.warn(`[${label}] attempt ${i} failed (status=${status ?? 'network'}), retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
  throw new Error(`[${label}] exhausted retries`);
}

interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId?: string;
}

function generateJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 10 * 60,
    iss: appId,
  };
  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

async function getInstallationToken(appId: string, privateKey: string, installationId?: string): Promise<string> {
  const baseUrl = 'https://api.github.com';

  try {
    const jwtToken = generateJWT(appId, privateKey);

    if (!installationId) {
      const res = await axios.get(`${baseUrl}/app/installations`, {
        headers: { Authorization: `Bearer ${jwtToken}`, Accept: 'application/vnd.github+json' },
      });
      if (!res.data.length) throw new Error('No GitHub App installations found');
      installationId = res.data[0].id;
    }

    const res = await axios.post(
      `${baseUrl}/app/installations/${installationId}/access_tokens`,
      {},
      { headers: { Authorization: `Bearer ${jwtToken}`, Accept: 'application/vnd.github+json' } },
    );

    return res.data.token;
  } catch (error: any) {
    const msg = error.response?.data?.message || error.message;
    logger.error('Failed to get GitHub App installation token', { message: msg, status: error.response?.status });
    throw new Error(`GitHub App auth failed: ${msg}`);
  }
}

export class GitHubClient {
  private token: string | null = null;
  private appConfig: GitHubAppConfig | null = null;
  private tokenExpiresAt: number = 0;
  private baseUrl = 'https://api.github.com';

  constructor(tokenOrAppId?: string, privateKey?: string, installationId?: string) {
    if (privateKey) {
      this.appConfig = {
        appId: tokenOrAppId || process.env.GITHUB_APP_ID || '',
        privateKey,
        installationId: installationId || process.env.GITHUB_APP_INSTALLATION_ID,
      };
    } else if (tokenOrAppId) {
      this.token = tokenOrAppId;
    } else {
      const appId = process.env.GITHUB_APP_ID;
      const pk = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
      if (appId && pk) {
        this.appConfig = {
          appId,
          privateKey: pk,
          installationId: process.env.GITHUB_APP_INSTALLATION_ID,
        };
      } else {
        this.token = process.env.GITHUB_TOKEN || '';
      }
    }
  }

  private async getToken(): Promise<string> {
    if (this.appConfig) {
      const now = Date.now();
      if (!this.token || now >= this.tokenExpiresAt) {
        logger.log('Generating new GitHub App installation token');
        this.token = await getInstallationToken(
          this.appConfig.appId,
          this.appConfig.privateKey,
          this.appConfig.installationId,
        );
        this.tokenExpiresAt = now + 55 * 60 * 1000;
      }
    }
    return this.token || '';
  }

  private async headers(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
    };
  }

  async getPR(owner: string, repo: string, prNumber: number): Promise<any> {
    try {
      const url = `${this.baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`;
      const res = await axios.get(url, { headers: await this.headers() });
      return res.data;
    } catch (error: any) {
      logger.error('Failed to get PR', { owner, repo, prNumber, message: error.message });
      throw error;
    }
  }

  async postComment(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    try {
      const headers = await this.headers();
      const existingId = await this.findBotComment(owner, repo, prNumber);
      if (existingId) {
        const url = `${this.baseUrl}/repos/${owner}/${repo}/issues/comments/${existingId}`;
        await withRetry('postComment.patch', () => axios.patch(url, { body }, { headers }));
        return;
      }
      const url = `${this.baseUrl}/repos/${owner}/${repo}/issues/${prNumber}/comments`;
      await withRetry('postComment.post', () => axios.post(url, { body }, { headers }));
    } catch (error: any) {
      logger.error('Failed to post comment', { owner, repo, prNumber, message: error.message });
      throw error;
    }
  }

  private async findBotComment(owner: string, repo: string, prNumber: number): Promise<number | null> {
    try {
      const url = `${this.baseUrl}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`;
      const res = await axios.get(url, { headers: await this.headers() });
      const botComment = res.data.find(
        (c: any) => c.body?.includes('Automated Testing Bot Report') && c.body?.includes('Generated by Automated Testing Bot'),
      );
      return botComment?.id || null;
    } catch {
      return null;
    }
  }

  async createLabel(owner: string, repo: string, name: string): Promise<void> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/labels`;
    const colors: Record<string, string> = {
      'tests-passed': '0e8a16', 'tests-failed': 'e11d48', 'tests-warning': 'fbca04',
      'accessibility-issues': 'd93f0b', 'performance-regression': 'f97316',
    };
    await axios.post(url, { name, color: colors[name] || 'ededed' }, { headers: await this.headers() });
  }

  async addLabel(owner: string, repo: string, prNumber: number, labels: string[]): Promise<void> {
    try {
      const url = `${this.baseUrl}/repos/${owner}/${repo}/issues/${prNumber}/labels`;
      const headers = await this.headers();
      await withRetry('addLabel', () => axios.post(url, { labels }, { headers }));
    } catch (error: any) {
      logger.error('Failed to add labels', { owner, repo, prNumber, labels, message: error.message });
      throw error;
    }
  }

  async createIssue(owner: string, repo: string, title: string, body: string): Promise<any> {
    try {
      const url = `${this.baseUrl}/repos/${owner}/${repo}/issues`;
      const res = await axios.post(url, { title, body }, { headers: await this.headers() });
      return res.data;
    } catch (error: any) {
      logger.error('Failed to create issue', { owner, repo, title, message: error.message });
      throw error;
    }
  }

  async createCheckRun(
    owner: string,
    repo: string,
    headSha: string,
    name: string,
    conclusion: 'success' | 'failure' | 'neutral',
    output: { title: string; summary: string },
  ): Promise<any> {
    try {
      const url = `${this.baseUrl}/repos/${owner}/${repo}/check-runs`;
      const headers = await this.headers();
      const res = await withRetry('createCheckRun', () =>
        axios.post(url, { name, head_sha: headSha, status: 'completed', conclusion, output }, { headers }),
      );
      return res.data;
    } catch (error: any) {
      logger.error('Failed to create check run', { owner, repo, name, message: error.message });
      throw error;
    }
  }
}
