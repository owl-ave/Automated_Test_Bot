export interface GitHubAppEnv {
  APP_ID: string;
  APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  BOT_REPO: string;
}

export function ghHeaders(token: string) {
  return { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TestingBot' };
}

// Generate JWT for GitHub App using Web Crypto API (works in Cloudflare Workers)
async function generateJWT(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now - 60, exp: now + 10 * 60, iss: appId };

  const header = { alg: 'RS256', typ: 'JWT' };
  const encode = (obj: object) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import PEM private key
  const pemBody = privateKeyPem.replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${signingInput}.${sigB64}`;
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
  const installations = await getInstallations(env.APP_ID, env.APP_PRIVATE_KEY);
  const allRepos: any[] = [];

  for (const inst of installations) {
    const token = await getInstallationToken(env.APP_ID, env.APP_PRIVATE_KEY, String(inst.id));
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
  const installations = await getInstallations(env.APP_ID, env.APP_PRIVATE_KEY);
  for (const inst of installations) {
    const token = await getInstallationToken(env.APP_ID, env.APP_PRIVATE_KEY, String(inst.id));
    const res = await fetch('https://api.github.com/installation/repositories?per_page=100', {
      headers: ghHeaders(token),
    });
    const data = await res.json() as any;
    const found = data.repositories?.find((r: any) => r.full_name === `${owner}/${repo}`);
    if (found) return token;
  }
  throw new Error(`App not installed on ${owner}/${repo}`);
}
