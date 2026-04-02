import { GitHubAppEnv, getTokenForRepo, ghHeaders } from './_github-app';

async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expected = 'sha256=' + Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return signature === expected;
}

export const onRequestPost: PagesFunction<GitHubAppEnv> = async (context) => {
  const secret = context.env.GITHUB_WEBHOOK_SECRET || '';
  const signature = context.request.headers.get('x-hub-signature-256') || '';
  const event = context.request.headers.get('x-github-event') || '';
  const body = await context.request.text();

  if (secret && !(await verifySignature(body, signature, secret))) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  if (event !== 'pull_request') return Response.json({ message: `Ignored event: ${event}` });

  const payload = JSON.parse(body);
  if (!['opened', 'synchronize', 'reopened'].includes(payload.action)) {
    return Response.json({ message: `Ignored PR action: ${payload.action}` });
  }

  const pr = payload.pull_request;
  const repo = payload.repository;
  const botRepo = context.env.BOT_REPO;
  if (!botRepo) return Response.json({ error: 'BOT_REPO not configured' }, { status: 500 });

  try {
    const [botOwner, botRepoName] = botRepo.split('/');
    const token = await getTokenForRepo(context.env, botOwner, botRepoName);

    await fetch(`https://api.github.com/repos/${botRepo}/actions/workflows/test-bot.yml/dispatches`, {
      method: 'POST',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: 'main',
        inputs: { repo: repo.full_name, pr_number: String(pr.number), branch: pr.head.ref },
      }),
    });

    return Response.json({ message: `Bot triggered for ${repo.full_name}#${pr.number}` });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
};
