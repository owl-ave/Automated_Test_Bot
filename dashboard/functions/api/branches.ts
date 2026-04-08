import { GitHubAppEnv, ghHeaders, getTokenForRepo } from './_github-app';

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  head_branch: string;
  display_title: string;
  event: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  triggering_actor?: { login: string };
  pull_requests?: Array<{ number: number }>;
  repository?: { full_name: string };
  inputs?: { repo?: string; branch?: string; pr_number?: string } | null;
}

interface ResolvedRun {
  id: number;
  repo: string;
  branch: string;
  prNumber: number | null;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  triggeredBy: string;
}

// Parse run-name format: "test owner/repo @ branch PR#123"
function parseDisplayTitle(title: string): { repo: string; branch: string; prNumber: number | null } {
  const match = title.match(/^test\s+(\S+)\s+@\s+(\S+)(?:\s+PR#(\d+))?$/);
  if (match) {
    return { repo: match[1], branch: match[2], prNumber: match[3] ? parseInt(match[3]) : null };
  }
  return { repo: '', branch: '', prNumber: null };
}

// Resolve repo/branch from detect job logs
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

    // GitHub returns 302 redirect to S3 for logs — must follow manually
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

function computeHealthScore(runs: ResolvedRun[]): number {
  if (runs.length === 0) return 0;

  const completed = runs.filter(r => r.status === 'completed');
  const passed = completed.filter(r => r.conclusion === 'success').length;
  const total = completed.length || 1;
  const passRate = (passed / total) * 100;

  const hoursSinceLast = (Date.now() - new Date(runs[0].created_at).getTime()) / 3600000;
  let recencyBonus = 25;
  if (hoursSinceLast < 24) recencyBonus = 100;
  else if (hoursSinceLast < 168) recencyBonus = 75;
  else if (hoursSinceLast < 720) recencyBonus = 50;

  const dailyMap: Record<string, { passed: number; total: number }> = {};
  completed.forEach(r => {
    const day = r.created_at.slice(0, 10);
    if (!dailyMap[day]) dailyMap[day] = { passed: 0, total: 0 };
    dailyMap[day].total++;
    if (r.conclusion === 'success') dailyMap[day].passed++;
  });
  const dailyRates = Object.values(dailyMap).map(d => (d.passed / d.total) * 100);
  let stabilityBonus = 100;
  if (dailyRates.length > 1) {
    const mean = dailyRates.reduce((a, b) => a + b, 0) / dailyRates.length;
    const variance = dailyRates.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyRates.length;
    stabilityBonus = Math.max(0, Math.min(100, 100 - Math.sqrt(variance) * 2));
  }

  return Math.round(passRate * 0.5 + recencyBonus * 0.2 + stabilityBonus * 0.2 + 10);
}

export const onRequestGet: PagesFunction<GitHubAppEnv> = async (context) => {
  const url = new URL(context.request.url);
  const repoParam = url.searchParams.get('repo');
  const branchParam = url.searchParams.get('branch');
  const compareParam = url.searchParams.get('compare');

  const botRepo = context.env.BOT_REPO;
  if (!botRepo || !context.env.APP_ID || !context.env.APP_PRIVATE_KEY_B64) {
    return Response.json({ error: 'Bot not configured' }, { status: 500 });
  }

  const [botOwner, botRepoName] = botRepo.split('/');

  try {
    const token = await getTokenForRepo(context.env, botOwner, botRepoName);

    const res = await fetch(
      `https://api.github.com/repos/${botRepo}/actions/workflows/test-bot.yml/runs?per_page=50`,
      { headers: ghHeaders(token) }
    );
    const data = (await res.json()) as { workflow_runs?: WorkflowRun[] };
    const allWorkflowRuns = data.workflow_runs || [];

    // Resolve repo/branch — parse display_title first, fall back to job logs (batched, max 10 concurrent)
    const needsResolve: { index: number; run: WorkflowRun }[] = [];
    const resolvedRuns: ResolvedRun[] = allWorkflowRuns.map((r, i) => {
      const parsed = parseDisplayTitle(r.display_title || '');
      const repo = r.inputs?.repo || parsed.repo;
      const branch = r.inputs?.branch || parsed.branch;
      const prNumber = r.inputs?.pr_number ? parseInt(r.inputs.pr_number) || null : parsed.prNumber;

      if (!repo) needsResolve.push({ index: i, run: r });

      return {
        id: r.id,
        repo: repo || '',
        branch: branch || r.head_branch || 'main',
        prNumber,
        status: r.status,
        conclusion: r.conclusion,
        created_at: r.created_at,
        updated_at: r.updated_at,
        html_url: r.html_url,
        triggeredBy: r.triggering_actor?.login || 'unknown',
      };
    });

    // Resolve unresolved runs in batches of 10 to avoid timeout
    for (let i = 0; i < needsResolve.length; i += 10) {
      const batch = needsResolve.slice(i, i + 10);
      const results = await Promise.all(
        batch.map(({ run }) => resolveRunMeta(run.id, token, botRepo))
      );
      batch.forEach(({ index }, j) => {
        const meta = results[j];
        resolvedRuns[index].repo = meta.repo || resolvedRuns[index].repo;
        resolvedRuns[index].branch = meta.branch || resolvedRuns[index].branch;
        resolvedRuns[index].prNumber = meta.prNumber || resolvedRuns[index].prNumber;
      });
    }

    // Filter by target repo
    const filteredRuns = repoParam
      ? resolvedRuns.filter(r => r.repo === repoParam)
      : resolvedRuns;

    // Group by branch
    const branchMap: Record<string, ResolvedRun[]> = {};
    filteredRuns.forEach(r => {
      if (!branchMap[r.branch]) branchMap[r.branch] = [];
      branchMap[r.branch].push(r);
    });

    // Specific branch detail
    if (branchParam) {
      const branchRuns = branchMap[branchParam] || [];

      if (branchRuns.length === 0) {
        return Response.json({
          branch: branchParam,
          repo: repoParam || '',
          summary: { totalRuns: 0, passed: 0, failed: 0, inProgress: 0, passRate: 0, avgDuration: 0, healthScore: 0 },
          trends: [],
          recentRuns: [],
        });
      }

      const completed = branchRuns.filter(r => r.status === 'completed');
      const passed = completed.filter(r => r.conclusion === 'success').length;
      const failed = completed.filter(r => r.conclusion === 'failure').length;
      const inProgress = branchRuns.filter(r => r.status === 'in_progress').length;

      const durations = completed
        .map(r => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime())
        .filter(d => d > 0);
      const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const trendMap: Record<string, { passed: number; failed: number; total: number }> = {};
      completed.forEach(r => {
        const day = r.created_at.slice(0, 10);
        if (day >= thirtyDaysAgo) {
          if (!trendMap[day]) trendMap[day] = { passed: 0, failed: 0, total: 0 };
          trendMap[day].total++;
          if (r.conclusion === 'success') trendMap[day].passed++;
          else trendMap[day].failed++;
        }
      });

      const detail: any = {
        branch: branchParam,
        repo: repoParam || '',
        summary: {
          totalRuns: branchRuns.length,
          passed,
          failed,
          inProgress,
          passRate: completed.length > 0 ? Math.round((passed / completed.length) * 1000) / 10 : 0,
          avgDuration,
          healthScore: computeHealthScore(branchRuns),
        },
        trends: Object.entries(trendMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, ...d })),
        recentRuns: branchRuns.slice(0, 20),
      };

      if (compareParam && branchMap[compareParam]) {
        const baseRuns = branchMap[compareParam];
        const baseCompleted = baseRuns.filter(r => r.status === 'completed');
        const basePassed = baseCompleted.filter(r => r.conclusion === 'success').length;
        const basePassRate = baseCompleted.length > 0 ? Math.round((basePassed / baseCompleted.length) * 1000) / 10 : 0;
        detail.comparison = {
          base: { name: compareParam, passRate: basePassRate, healthScore: computeHealthScore(baseRuns) },
          delta: {
            passRate: Math.round((detail.summary.passRate - basePassRate) * 10) / 10,
            healthScore: detail.summary.healthScore - computeHealthScore(baseRuns),
          },
        };
      }

      return Response.json(detail);
    }

    // Branch list
    const branches = Object.entries(branchMap)
      .map(([name, runs]) => {
        const completed = runs.filter(r => r.status === 'completed');
        const passed = completed.filter(r => r.conclusion === 'success').length;
        return {
          name,
          repo: repoParam || runs[0]?.repo || '',
          totalRuns: runs.length,
          passed,
          failed: completed.filter(r => r.conclusion === 'failure').length,
          inProgress: runs.filter(r => r.status === 'in_progress').length,
          passRate: completed.length > 0 ? Math.round((passed / completed.length) * 1000) / 10 : 0,
          lastRun: runs[0]?.created_at || null,
          lastStatus: runs[0]?.conclusion || runs[0]?.status || 'unknown',
          healthScore: computeHealthScore(runs),
        };
      })
      .sort((a, b) => (b.lastRun || '').localeCompare(a.lastRun || ''));

    return Response.json({ branches });
  } catch (err: any) {
    return Response.json({ error: err.message || 'Failed to fetch branch data', stack: err.stack }, { status: 500 });
  }
};
