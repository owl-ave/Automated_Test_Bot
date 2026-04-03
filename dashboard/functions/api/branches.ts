import { GitHubAppEnv, ghHeaders, getTokenForRepo } from './_github-app';

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  head_branch: string;
  event: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  triggering_actor?: { login: string };
  pull_requests?: Array<{ number: number }>;
  repository?: { full_name: string };
  run_started_at?: string;
}

interface BranchSummary {
  name: string;
  repo: string;
  totalRuns: number;
  passed: number;
  failed: number;
  inProgress: number;
  passRate: number;
  lastRun: string | null;
  lastStatus: string;
  healthScore: number;
}

function computeHealthScore(runs: WorkflowRun[]): number {
  if (runs.length === 0) return 0;

  const completed = runs.filter(r => r.status === 'completed');
  const passed = completed.filter(r => r.conclusion === 'success').length;
  const total = completed.length || 1;
  const passRate = (passed / total) * 100;

  // Recency bonus
  const lastRun = runs[0];
  const hoursSinceLast = (Date.now() - new Date(lastRun.created_at).getTime()) / 3600000;
  let recencyBonus = 25;
  if (hoursSinceLast < 24) recencyBonus = 100;
  else if (hoursSinceLast < 168) recencyBonus = 75;
  else if (hoursSinceLast < 720) recencyBonus = 50;

  // Stability bonus — standard deviation of daily pass rates
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

    // Fetch workflow runs (up to 100 for branch analysis)
    const res = await fetch(
      `https://api.github.com/repos/${botRepo}/actions/workflows/test-bot.yml/runs?per_page=100`,
      { headers: ghHeaders(token) }
    );
    const data = (await res.json()) as { workflow_runs?: WorkflowRun[] };
    const allRuns = data.workflow_runs || [];

    // Filter by target repo if specified
    const filteredRuns = repoParam
      ? allRuns.filter(r => {
          // Check if the workflow was triggered for this repo (via inputs or repository)
          const runRepo = r.repository?.full_name || botRepo;
          return runRepo === repoParam || runRepo === botRepo;
        })
      : allRuns;

    // Group runs by branch
    const branchMap: Record<string, WorkflowRun[]> = {};
    filteredRuns.forEach(r => {
      const b = r.head_branch || 'unknown';
      if (!branchMap[b]) branchMap[b] = [];
      branchMap[b].push(r);
    });

    // If specific branch requested — return detail
    if (branchParam) {
      const branchRuns = branchMap[branchParam] || [];

      if (branchRuns.length === 0) {
        return Response.json({
          branch: branchParam,
          repo: repoParam || botRepo,
          summary: { totalRuns: 0, passed: 0, failed: 0, inProgress: 0, passRate: 0, avgDuration: 0, healthScore: 0 },
          trends: [],
          recentRuns: [],
          scenarioCoverage: {},
          failureReasons: [],
          platforms: {},
        });
      }

      const completed = branchRuns.filter(r => r.status === 'completed');
      const passed = completed.filter(r => r.conclusion === 'success').length;
      const failed = completed.filter(r => r.conclusion === 'failure').length;
      const inProgress = branchRuns.filter(r => r.status === 'in_progress').length;

      // Compute average duration (ms)
      const durations = completed
        .map(r => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime())
        .filter(d => d > 0);
      const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

      // Daily trends (last 30 days)
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
      const trends = Object.entries(trendMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({ date, ...d }));

      // Recent runs
      const recentRuns = branchRuns.slice(0, 20).map(r => ({
        id: r.id,
        status: r.status,
        conclusion: r.conclusion,
        branch: r.head_branch,
        event: r.event,
        prNumber: r.pull_requests?.[0]?.number || null,
        triggeredBy: r.triggering_actor?.login || 'unknown',
        startedAt: r.created_at,
        completedAt: r.updated_at,
        url: r.html_url,
        repo: r.repository?.full_name || botRepo,
      }));

      const detail: any = {
        branch: branchParam,
        repo: repoParam || botRepo,
        summary: {
          totalRuns: branchRuns.length,
          passed,
          failed,
          inProgress,
          passRate: completed.length > 0 ? Math.round((passed / completed.length) * 1000) / 10 : 0,
          avgDuration,
          healthScore: computeHealthScore(branchRuns),
        },
        trends,
        recentRuns,
      };

      // If comparison requested
      if (compareParam && branchMap[compareParam]) {
        const baseRuns = branchMap[compareParam];
        const baseCompleted = baseRuns.filter(r => r.status === 'completed');
        const basePassed = baseCompleted.filter(r => r.conclusion === 'success').length;
        const basePassRate = baseCompleted.length > 0 ? Math.round((basePassed / baseCompleted.length) * 1000) / 10 : 0;
        const baseDurations = baseCompleted
          .map(r => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime())
          .filter(d => d > 0);
        const baseAvgDuration = baseDurations.length > 0 ? Math.round(baseDurations.reduce((a, b) => a + b, 0) / baseDurations.length) : 0;

        detail.comparison = {
          base: {
            name: compareParam,
            totalRuns: baseRuns.length,
            passRate: basePassRate,
            avgDuration: baseAvgDuration,
            healthScore: computeHealthScore(baseRuns),
          },
          delta: {
            passRate: Math.round((detail.summary.passRate - basePassRate) * 10) / 10,
            avgDuration: avgDuration - baseAvgDuration,
            healthScore: detail.summary.healthScore - computeHealthScore(baseRuns),
          },
        };
      }

      return Response.json(detail);
    }

    // Return branch list with summaries
    const branches: BranchSummary[] = Object.entries(branchMap)
      .map(([name, runs]) => {
        const completed = runs.filter(r => r.status === 'completed');
        const passed = completed.filter(r => r.conclusion === 'success').length;
        const failed = completed.filter(r => r.conclusion === 'failure').length;
        const inProgress = runs.filter(r => r.status === 'in_progress').length;

        return {
          name,
          repo: repoParam || botRepo,
          totalRuns: runs.length,
          passed,
          failed,
          inProgress,
          passRate: completed.length > 0 ? Math.round((passed / completed.length) * 1000) / 10 : 0,
          lastRun: runs[0]?.created_at || null,
          lastStatus: runs[0]?.conclusion || runs[0]?.status || 'unknown',
          healthScore: computeHealthScore(runs),
        };
      })
      .sort((a, b) => (b.lastRun || '').localeCompare(a.lastRun || ''));

    return Response.json({ branches });
  } catch (err: any) {
    return Response.json({ error: err.message || 'Failed to fetch branch data' }, { status: 500 });
  }
};
