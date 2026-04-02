import { GitHubAppEnv, getTokenForRepo, ghHeaders } from './_github-app';

export const onRequestPost: PagesFunction<GitHubAppEnv> = async (context) => {
  const { repoOwner, repoName, prNumber, branch } = (await context.request.json()) as any;

  if (!repoOwner || !repoName) {
    return Response.json({ error: 'repoOwner and repoName are required' }, { status: 400 });
  }

  const botRepo = context.env.BOT_REPO;
  if (!botRepo) return Response.json({ error: 'BOT_REPO not configured' }, { status: 500 });

  try {
    const [botOwner, botRepoName] = botRepo.split('/');
    const token = await getTokenForRepo(context.env, botOwner, botRepoName);

    // If PR number given but no branch, fetch PR branch automatically
    let targetBranch = branch || 'main';
    if (prNumber && !branch) {
      try {
        const targetToken = await getTokenForRepo(context.env, repoOwner, repoName);
        const prRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls/${prNumber}`, {
          headers: ghHeaders(targetToken),
        });
        const prData = await prRes.json() as any;
        if (prData.head?.ref) targetBranch = prData.head.ref;
      } catch { /* fallback to main */ }
    }

    const res = await fetch(`https://api.github.com/repos/${botRepo}/actions/workflows/test-bot.yml/dispatches`, {
      method: 'POST',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          repo: `${repoOwner}/${repoName}`,
          pr_number: prNumber ? String(prNumber) : '0',
          branch: targetBranch,
        },
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
