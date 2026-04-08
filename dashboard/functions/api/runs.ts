import { GitHubAppEnv, ghHeaders, getTokenForRepo } from './_github-app';

function parseDisplayTitle(title: string): { repo: string; branch: string; prNumber: number | null } {
  const match = title.match(/^test\s+(\S+)\s+@\s+(\S+)(?:\s+PR#(\d+))?$/);
  if (match) return { repo: match[1], branch: match[2], prNumber: match[3] ? parseInt(match[3]) : null };
  return { repo: '', branch: '', prNumber: null };
}

async function resolveRunMeta(
  runId: number, token: string, botRepo: string
): Promise<{ repo: string; branch: string; prNumber: number | null }> {
  try {
    const jobsRes = await fetch(
      `https://api.github.com/repos/${botRepo}/actions/runs/${runId}/jobs`,
      { headers: ghHeaders(token) }
    );
    const jobsData = (await jobsRes.json()) as any;
    const detectJob = (jobsData.jobs || []).find((j: any) => j.name === 'detect');
    if (!detectJob) return { repo: '', branch: 'main', prNumber: null };

    const logRedirect = await fetch(
      `https://api.github.com/repos/${botRepo}/actions/jobs/${detectJob.id}/logs`,
      { headers: ghHeaders(token), redirect: 'manual' }
    );
    const logUrl = logRedirect.headers.get('location');
    if (!logUrl) return { repo: '', branch: 'main', prNumber: null };
    const logRes = await fetch(logUrl);
    const logText = await logRes.text();

    const repoMatch = logText.match(/read -r owner repo <<< "([^"]+)"/);
    const refMatch = logText.match(/\s+ref:\s+(\S+)/);

    let branch = 'main';
    let prNumber: number | null = null;
    if (refMatch) {
      const ref = refMatch[1];
      const prRefMatch = ref.match(/^refs\/pull\/(\d+)\/head$/);
      if (prRefMatch) {
        prNumber = parseInt(prRefMatch[1]);
        branch = `PR-${prRefMatch[1]}`;
      } else {
        branch = ref.replace(/^refs\/heads\//, '');
      }
    }

    return { repo: repoMatch ? repoMatch[1] : '', branch, prNumber };
  } catch {
    return { repo: '', branch: 'main', prNumber: null };
  }
}

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

    const runs = await Promise.all((data.workflow_runs || []).map(async (r: any) => {
      const parsed = parseDisplayTitle(r.display_title || '');
      let runRepo = r.inputs?.repo || parsed.repo;
      let branch = r.inputs?.branch || parsed.branch;
      let prNumber = r.inputs?.pr_number ? parseInt(r.inputs.pr_number) || null : parsed.prNumber;

      if (!runRepo) {
        const meta = await resolveRunMeta(r.id, token, botRepo);
        runRepo = meta.repo;
        branch = branch || meta.branch;
        prNumber = prNumber || meta.prNumber;
      }

      return {
        id: r.id,
        repo: runRepo || r.repository?.full_name || botRepo,
        branch: branch || r.head_branch || 'main',
        prNumber,
        status: r.status,
        conclusion: r.conclusion,
        triggeredBy: r.triggering_actor?.login || 'unknown',
        startedAt: r.created_at,
        completedAt: r.updated_at,
        url: r.html_url,
      };
    }));
    return Response.json(runs);
  } catch {
    return Response.json([]);
  }
};
