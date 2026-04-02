export interface GitHubAppEnv {
  APP_ID: string;
  APP_PRIVATE_KEY_B64: string;
  GITHUB_WEBHOOK_SECRET: string;
  BOT_REPO: string;
}

export function ghHeaders(token: string) {
  return { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TestingBot' };
}

// Generate JWT using jose library (handles PKCS8 PEM natively)
async function generateJWT(appId: string, privateKeyB64: string): Promise<string> {
  const { SignJWT, importPKCS8 } = await import('jose');
  // Decode base64-encoded PEM
  const pem = atob(privateKeyB64);
  const key = await importPKCS8(pem, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: appId })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 10 * 60)
    .sign(key);
}

// Get installation access token for a specific installation
async function getInstallationToken(appId: string, privateKey: string, installationId: string): Promise<string> {
  const jwt = await generateJWT(appId, privateKey);
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TestingBot' },
  });
  const data = await res.json() as any;
  return data.token;
}

// Get all installations of this app
async function getInstallations(appId: string, privateKey: string): Promise<any[]> {
  const jwt = await generateJWT(appId, privateKey);
  const res = await fetch('https://api.github.com/app/installations', {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TestingBot' },
  });
  return res.json() as Promise<any[]>;
}

// Get all repos across all installations
export async function getInstalledRepos(env: GitHubAppEnv): Promise<any[]> {
  const installations = await getInstallations(env.APP_ID, env.APP_PRIVATE_KEY_B64);
  const allRepos: any[] = [];

  for (const inst of installations) {
    const token = await getInstallationToken(env.APP_ID, env.APP_PRIVATE_KEY_B64, String(inst.id));
    const res = await fetch('https://api.github.com/installation/repositories?per_page=100', {
      headers: ghHeaders(token),
    });
    const data = await res.json() as any;
    if (data.repositories) allRepos.push(...data.repositories);
  }

  return allRepos;
}

// Get installation token for a specific repo
export async function getTokenForRepo(env: GitHubAppEnv, owner: string, repo: string): Promise<string> {
  const jwt = await generateJWT(env.APP_ID, env.APP_PRIVATE_KEY_B64);
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TestingBot' },
  });
  if (!res.ok) throw new Error(`App not installed on ${owner}/${repo} (HTTP ${res.status})`);
  const inst = await res.json() as any;
  return getInstallationToken(env.APP_ID, env.APP_PRIVATE_KEY_B64, String(inst.id));
}
