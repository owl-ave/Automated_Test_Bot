import { GitHubAppEnv, ghHeaders, getTokenForRepo } from './_github-app';

export const onRequestGet: PagesFunction<GitHubAppEnv> = async (context) => {
  const botRepo = context.env.BOT_REPO;
  if (!botRepo || !context.env.APP_ID || !context.env.APP_PRIVATE_KEY_B64) return Response.json([]);

  const [owner, repo] = botRepo.split('/');

  try {
    const token = await getTokenForRepo(context.env, owner, repo);
    const res = await fetch(`https://api.github.com/repos/${botRepo}/actions/workflows/test-bot.yml/runs?per_page=20`, {
      headers: ghHeaders(token),
    });
    const data = (await res.json()) as any;

    const runs = (data.workflow_runs || []).map((r: any) => ({
      id: r.id, status: r.status, conclusion: r.conclusion, branch: r.head_branch,
      event: r.event, prNumber: r.pull_requests?.[0]?.number || null,
      triggeredBy: r.triggering_actor?.login || 'unknown',
      startedAt: r.created_at, completedAt: r.updated_at, url: r.html_url,
      repo: r.repository?.full_name || botRepo,
    }));
    return Response.json(runs);
  } catch {
    return Response.json([]);
  }
};
