/**
 * Local dev server — proxies dashboard to GitHub Actions API.
 * Run: npm run dashboard
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.dev.vars') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import axios from 'axios';

const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT || '3333', 10);
const BOT_REPO = process.env.BOT_REPO || 'owl-ave/Automated_Test_Bot';
const WORKFLOW_FILE = 'test-bot.yml';

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', express.json());

function getToken(): string {
  const pat = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
  if (!pat) throw new Error('GITHUB_PAT or GITHUB_TOKEN not set');
  return pat;
}

const gh = (token: string) => ({
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'TestingBot-Dashboard',
});

// GET /api/repos
app.get('/api/repos', async (_req, res) => {
  try {
    const { data } = await axios.get(
      'https://api.github.com/user/repos?per_page=100&sort=updated',
      { headers: gh(getToken()) }
    );
    res.json(data.map((r: any) => ({
      fullName: r.full_name,
      owner: r.owner.login,
      name: r.name,
      defaultBranch: r.default_branch,
      private: r.private,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/pulls?owner=x&repo=y
app.get('/api/pulls', async (req, res) => {
  const { owner, repo } = req.query;
  if (!owner || !repo) return res.status(400).json({ error: 'owner and repo required' });
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=50`,
      { headers: gh(getToken()) }
    );
    res.json(data.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.head.ref,
      author: pr.user.login,
      createdAt: pr.created_at,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// POST /api/trigger — triggers GitHub Actions workflow_dispatch
app.post('/api/trigger', async (req, res) => {
  const { repoOwner, repoName, prNumber, branch } = req.body;
  if (!repoOwner || !repoName) return res.status(400).json({ error: 'repoOwner and repoName required' });

  const [botOwner, botRepo] = BOT_REPO.split('/');
  const targetRepo = `${repoOwner}/${repoName}`;
  const targetBranch = branch || 'main';

  try {
    await axios.post(
      `https://api.github.com/repos/${botOwner}/${botRepo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        ref: 'main',
        inputs: {
          repo: targetRepo,
          pr_number: prNumber ? String(prNumber) : '0',
          branch: targetBranch,
        },
      },
      { headers: gh(getToken()) }
    );

    res.json({
      status: 'triggered',
      message: `Workflow dispatched for ${targetRepo}${prNumber ? ' PR #' + prNumber : ''}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/runs — list workflow runs from GitHub Actions
app.get('/api/runs', async (_req, res) => {
  const [botOwner, botRepo] = BOT_REPO.split('/');
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${botOwner}/${botRepo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=50`,
      { headers: gh(getToken()) }
    );

    const runs = (data.workflow_runs || []).map((r: any) => ({
      id: String(r.id),
      repo: r.inputs?.repo || r.display_title || '',
      prNumber: r.inputs?.pr_number ? parseInt(r.inputs.pr_number) || null : null,
      branch: r.inputs?.branch || r.head_branch || 'main',
      status: mapStatus(r.status),
      conclusion: r.conclusion === 'success' ? 'success' : r.conclusion === 'failure' ? 'failure' : r.conclusion === 'cancelled' ? 'cancelled' : undefined,
      startedAt: r.created_at,
      completedAt: r.updated_at || null,
      triggeredBy: r.triggering_actor?.login || 'dashboard',
      url: r.html_url,
    }));

    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

function mapStatus(ghStatus: string): 'queued' | 'in_progress' | 'completed' {
  if (ghStatus === 'completed') return 'completed';
  if (ghStatus === 'in_progress') return 'in_progress';
  return 'queued';
}

// GET /api/runs/:id — single run details
app.get('/api/runs/:id', async (req, res) => {
  const [botOwner, botRepo] = BOT_REPO.split('/');
  try {
    const { data: r } = await axios.get(
      `https://api.github.com/repos/${botOwner}/${botRepo}/actions/runs/${req.params.id}`,
      { headers: gh(getToken()) }
    );
    res.json({
      id: String(r.id),
      repo: r.inputs?.repo || r.display_title || '',
      prNumber: r.inputs?.pr_number ? parseInt(r.inputs.pr_number) || null : null,
      branch: r.inputs?.branch || r.head_branch || 'main',
      status: mapStatus(r.status),
      conclusion: r.conclusion,
      startedAt: r.created_at,
      completedAt: r.updated_at || null,
      url: r.html_url,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/runs/:id/logs — fetch job logs from GitHub Actions
app.get('/api/runs/:id/logs', async (req, res) => {
  const [botOwner, botRepo] = BOT_REPO.split('/');
  const token = getToken();

  try {
    // Get run status
    const { data: run } = await axios.get(
      `https://api.github.com/repos/${botOwner}/${botRepo}/actions/runs/${req.params.id}`,
      { headers: gh(token) }
    );

    // Get jobs for this run
    const { data: jobsData } = await axios.get(
      `https://api.github.com/repos/${botOwner}/${botRepo}/actions/runs/${req.params.id}/jobs`,
      { headers: gh(token) }
    );

    const logs: string[] = [];

    for (const job of (jobsData.jobs || [])) {
      logs.push(`\n=== Job: ${job.name} [${job.status}${job.conclusion ? '/' + job.conclusion : ''}] ===`);
      for (const step of (job.steps || [])) {
        const icon = step.conclusion === 'success' ? '✓' : step.conclusion === 'failure' ? '✗' : '○';
        logs.push(`  ${icon} ${step.name}`);
      }

      // Fetch raw logs for this job if completed
      if (job.status === 'completed') {
        try {
          const logRes = await axios.get(
            `https://api.github.com/repos/${botOwner}/${botRepo}/actions/jobs/${job.id}/logs`,
            { headers: gh(token), maxRedirects: 5, responseType: 'text' }
          );
          // Trim to last 200 lines to avoid huge payloads
          const lines = String(logRes.data).split('\n');
          const trimmed = lines.slice(-200);
          trimmed.forEach(l => logs.push(l));
        } catch {
          logs.push(`  [Logs not available yet]`);
        }
      }
    }

    res.json({
      logs,
      status: mapStatus(run.status),
      conclusion: run.conclusion,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/branches — branch analysis from workflow runs
app.get('/api/branches', async (req, res) => {
  const [botOwner, botRepo] = BOT_REPO.split('/');
  const filterRepo = req.query.repo as string | undefined;
  const branch = req.query.branch as string | undefined;
  const compare = req.query.compare as string | undefined;

  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${botOwner}/${botRepo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=100`,
      { headers: gh(getToken()) }
    );

    const allRuns = (data.workflow_runs || [])
      .filter((r: any) => !filterRepo || r.inputs?.repo === filterRepo)
      .map((r: any) => ({
        id: String(r.id),
        repo: r.inputs?.repo || '',
        branch: r.inputs?.branch || 'main',
        status: mapStatus(r.status),
        conclusion: r.conclusion,
        startedAt: r.created_at,
        prNumber: r.inputs?.pr_number ? parseInt(r.inputs.pr_number) || null : null,
      }));

    // Group by branch
    const branchMap: Record<string, any[]> = {};
    allRuns.forEach((r: any) => {
      const b = r.branch || 'main';
      if (!branchMap[b]) branchMap[b] = [];
      branchMap[b].push(r);
    });

    function healthScore(runs: any[]): number {
      if (!runs.length) return 0;
      const completed = runs.filter(r => r.status === 'completed');
      const passed = completed.filter(r => r.conclusion === 'success').length;
      const passRate = completed.length > 0 ? (passed / completed.length) * 100 : 0;
      const hoursSince = (Date.now() - new Date(runs[0].startedAt).getTime()) / 3600000;
      const recency = hoursSince < 24 ? 100 : hoursSince < 168 ? 75 : hoursSince < 720 ? 50 : 25;
      return Math.round(passRate * 0.6 + recency * 0.4);
    }

    // Specific branch detail
    if (branch) {
      const branchRuns = branchMap[branch] || [];
      const completed = branchRuns.filter(r => r.status === 'completed');
      const passed = completed.filter(r => r.conclusion === 'success').length;
      const failed = completed.filter(r => r.conclusion === 'failure').length;

      const trendMap: Record<string, { passed: number; failed: number; total: number }> = {};
      completed.forEach(r => {
        const day = r.startedAt.slice(0, 10);
        if (!trendMap[day]) trendMap[day] = { passed: 0, failed: 0, total: 0 };
        trendMap[day].total++;
        if (r.conclusion === 'success') trendMap[day].passed++;
        else trendMap[day].failed++;
      });

      const detail: any = {
        branch,
        repo: filterRepo || '',
        summary: {
          totalRuns: branchRuns.length,
          passed,
          failed,
          inProgress: branchRuns.filter(r => r.status === 'in_progress').length,
          passRate: completed.length > 0 ? Math.round((passed / completed.length) * 1000) / 10 : 0,
          avgDuration: 0,
          healthScore: healthScore(branchRuns),
        },
        trends: Object.entries(trendMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, d]) => ({ date, ...d })),
        recentRuns: branchRuns.slice(0, 20),
      };

      if (compare && branchMap[compare]) {
        const baseRuns = branchMap[compare];
        const baseCompleted = baseRuns.filter(r => r.status === 'completed');
        const basePassed = baseCompleted.filter(r => r.conclusion === 'success').length;
        const basePassRate = baseCompleted.length > 0 ? Math.round((basePassed / baseCompleted.length) * 1000) / 10 : 0;
        detail.comparison = {
          base: { name: compare, passRate: basePassRate, healthScore: healthScore(baseRuns) },
          delta: {
            passRate: Math.round((detail.summary.passRate - basePassRate) * 10) / 10,
            healthScore: detail.summary.healthScore - healthScore(baseRuns),
          },
        };
      }

      return res.json(detail);
    }

    // Branch list
    const branches = Object.entries(branchMap).map(([name, runs]) => {
      const completed = runs.filter(r => r.status === 'completed');
      const passed = completed.filter(r => r.conclusion === 'success').length;
      return {
        name,
        repo: filterRepo || runs[0]?.repo || '',
        totalRuns: runs.length,
        passed,
        failed: completed.filter(r => r.conclusion === 'failure').length,
        inProgress: runs.filter(r => r.status === 'in_progress').length,
        passRate: completed.length > 0 ? Math.round((passed / completed.length) * 1000) / 10 : 0,
        lastRun: runs[0]?.startedAt || null,
        lastStatus: runs[0]?.conclusion || runs[0]?.status || 'unknown',
        healthScore: healthScore(runs),
      };
    }).sort((a, b) => (b.lastRun || '').localeCompare(a.lastRun || ''));

    res.json({ branches });
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// SPA fallback
app.get('/{*path}', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  Dashboard: http://localhost:${PORT}`);
  console.log(`  Mode:      GITHUB ACTIONS (workflow_dispatch)`);
  console.log(`  Bot repo:  ${BOT_REPO}`);
  console.log(`  Token:     ${(process.env.GITHUB_PAT || process.env.GITHUB_TOKEN) ? 'SET ✓' : 'NOT SET ✗'}\n`);
});
