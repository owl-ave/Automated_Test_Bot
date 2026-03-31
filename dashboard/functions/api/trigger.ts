import { GitHubAppEnv, ghHeaders } from './_github-app';

export const onRequestPost: PagesFunction<GitHubAppEnv> = async (context) => {
  const { repoOwner, repoName, prNumber, branch } = (await context.request.json()) as any;

  if (!repoOwner || !repoName) {
    return Response.json({ error: 'repoOwner and repoName are required' }, { status: 400 });
  }

  const token = context.env.GITHUB_PAT;
  if (!token) return Response.json({ error: 'GITHUB_PAT not configured' }, { status: 500 });

  const botRepo = context.env.BOT_REPO || `${repoOwner}/${repoName}`;

  try {
    const res = await fetch(`https://api.github.com/repos/${botRepo}/actions/workflows/test-bot.yml/dispatches`, {
      method: 'POST',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: 'main',
        inputs: { repo: `${repoOwner}/${repoName}`, pr_number: prNumber ? String(prNumber) : '0', branch: branch || 'main' },
      }),
    });

    if (res.status === 204) {
      return Response.json({ status: 'triggered', message: `Bot triggered for ${repoOwner}/${repoName}${prNumber ? ' PR #' + prNumber : ' (full test)'}` });
    }
    const error = await res.text();
    return Response.json({ error: `GitHub: ${res.status} — ${error}` }, { status: res.status });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
};
