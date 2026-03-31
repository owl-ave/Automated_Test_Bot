export interface GitHubAppEnv {
  GITHUB_PAT: string;
  GITHUB_WEBHOOK_SECRET: string;
  BOT_REPO: string;
}

export function ghHeaders(token: string) {
  return { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TestingBot' };
}
