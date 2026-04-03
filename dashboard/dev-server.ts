/**
 * Local dev server — runs dashboard + bot locally (no GitHub Actions needed).
 * Run: npm run dashboard
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.dev.vars') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import axios from 'axios';
import { spawn, ChildProcess } from 'child_process';

const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT || '3333', 10);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', express.json());

// --- Auth ---
function getToken(): string {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error('GITHUB_PAT not set in dashboard/.dev.vars');
  return pat;
}
const gh = (token: string) => ({
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'TestingBot',
});

// --- In-memory run tracker ---
interface Run {
  id: string;
  repo: string;
  prNumber: number | null;
  branch: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | null;
  event: string;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  logs: string[];
  url: string;
}

const runs: Map<string, Run> = new Map();

// GET /api/repos
app.get('/api/repos', async (_req, res) => {
  try {
    const { data } = await axios.get('https://api.github.com/user/repos?per_page=100&sort=updated', { headers: gh(getToken()) });
    res.json(data.map((r: any) => ({ fullName: r.full_name, owner: r.owner.login, name: r.name, defaultBranch: r.default_branch, private: r.private })));
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/pulls?owner=x&repo=y
app.get('/api/pulls', async (req, res) => {
  const { owner, repo } = req.query;
  if (!owner || !repo) return res.status(400).json({ error: 'owner and repo required' });
  try {
    const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=50`, { headers: gh(getToken()) });
    res.json(data.map((pr: any) => ({ number: pr.number, title: pr.title, branch: pr.head.ref, author: pr.user.login, createdAt: pr.created_at })));
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// POST /api/trigger — runs bot LOCALLY as child process
app.post('/api/trigger', (req, res) => {
  const { repoOwner, repoName, prNumber, branch } = req.body;
  if (!repoOwner || !repoName) return res.status(400).json({ error: 'repoOwner and repoName required' });

  const runId = `local-${Date.now()}`;
  const repo = `${repoOwner}/${repoName}`;

  const run: Run = {
    id: runId,
    repo,
    prNumber: prNumber || null,
    branch: branch || 'main',
    status: 'in_progress',
    conclusion: null,
    event: 'local_trigger',
    triggeredBy: 'dashboard',
    startedAt: new Date().toISOString(),
    completedAt: null,
    logs: [`[${new Date().toISOString()}] Bot started for ${repo}${prNumber ? ' PR #' + prNumber : ' (full test)'}`],
    url: '',
  };
  runs.set(runId, run);

  // Spawn bot as child process
  const prArg = prNumber ? String(prNumber) : '0';
  const child = spawn('npx', ['ts-node', 'src/index.ts', prArg], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      GITHUB_REPOSITORY: repo,
      ...(branch ? { GITHUB_HEAD_REF: branch } : {}),
      GITHUB_TOKEN: getToken(),
    },
    shell: true,
  });

  child.stdout.on('data', (data: Buffer) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line.trim()) run.logs.push(line.trim());
    });
  });

  child.stderr.on('data', (data: Buffer) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line.trim()) run.logs.push(`[ERR] ${line.trim()}`);
    });
  });

  child.on('close', (code) => {
    run.status = 'completed';
    run.conclusion = code === 0 ? 'success' : 'failure';
    run.completedAt = new Date().toISOString();
    run.logs.push(`[${run.completedAt}] Bot finished — exit code ${code}`);
  });

  res.json({
    status: 'triggered',
    message: `Bot running locally for ${repo}${prNumber ? ' PR #' + prNumber : ' (full test)'}`,
    runId,
  });
});

// --- Branch Analysis ---

function computeHealthScore(branchRuns: Run[]): number {
  if (branchRuns.length === 0) return 0;
  const completed = branchRuns.filter(r => r.status === 'completed');
  const passed = completed.filter(r => r.conclusion === 'success').length;
  const total = completed.length || 1;
  const passRate = (passed / total) * 100;

  const lastRun = branchRuns[0];
  const hoursSinceLast = (Date.now() - new Date(lastRun.startedAt).getTime()) / 3600000;
  let recencyBonus = 25;
  if (hoursSinceLast < 24) recencyBonus = 100;
  else if (hoursSinceLast < 168) recencyBonus = 75;
  else if (hoursSinceLast < 720) recencyBonus = 50;

  const dailyMap: Record<string, { passed: number; total: number }> = {};
  completed.forEach(r => {
    const day = r.startedAt.slice(0, 10);
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

// GET /api/branches — list branches with summaries, or detail for a specific branch
app.get('/api/branches', (_req, res) => {
  const repo = _req.query.repo as string | undefined;
  const branch = _req.query.branch as string | undefined;
  const compare = _req.query.compare as string | undefined;

  const allRuns = Array.from(runs.values())
    .filter(r => !repo || r.repo === repo)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  // Group by branch
  const branchMap: Record<string, Run[]> = {};
  allRuns.forEach(r => {
    const b = r.branch || 'main';
    if (!branchMap[b]) branchMap[b] = [];
    branchMap[b].push(r);
  });

  // Specific branch detail
  if (branch) {
    const branchRuns = branchMap[branch] || [];
    if (branchRuns.length === 0) {
      return res.json({
        branch, repo: repo || '',
        summary: { totalRuns: 0, passed: 0, failed: 0, inProgress: 0, passRate: 0, avgDuration: 0, healthScore: 0 },
        trends: [], recentRuns: [],
      });
    }

    const completed = branchRuns.filter(r => r.status === 'completed');
    const passed = completed.filter(r => r.conclusion === 'success').length;
    const failed = completed.filter(r => r.conclusion === 'failure').length;
    const inProgress = branchRuns.filter(r => r.status === 'in_progress').length;

    // Daily trends
    const trendMap: Record<string, { passed: number; failed: number; total: number }> = {};
    completed.forEach(r => {
      const day = r.startedAt.slice(0, 10);
      if (!trendMap[day]) trendMap[day] = { passed: 0, failed: 0, total: 0 };
      trendMap[day].total++;
      if (r.conclusion === 'success') trendMap[day].passed++;
      else trendMap[day].failed++;
    });
    const trends = Object.entries(trendMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, ...d }));

    const recentRuns = branchRuns.slice(0, 20).map(r => ({
      id: r.id, status: r.status, conclusion: r.conclusion, branch: r.branch,
      event: r.event, prNumber: r.prNumber, triggeredBy: r.triggeredBy,
      startedAt: r.startedAt, completedAt: r.completedAt, url: r.url, repo: r.repo,
    }));

    const detail: any = {
      branch, repo: repo || branchRuns[0]?.repo || '',
      summary: {
        totalRuns: branchRuns.length, passed, failed, inProgress,
        passRate: completed.length > 0 ? Math.round((passed / completed.length) * 1000) / 10 : 0,
        avgDuration: 0,
        healthScore: computeHealthScore(branchRuns),
      },
      trends, recentRuns,
    };

    // Comparison
    if (compare && branchMap[compare]) {
      const baseRuns = branchMap[compare];
      const baseCompleted = baseRuns.filter(r => r.status === 'completed');
      const basePassed = baseCompleted.filter(r => r.conclusion === 'success').length;
      const basePassRate = baseCompleted.length > 0 ? Math.round((basePassed / baseCompleted.length) * 1000) / 10 : 0;

      detail.comparison = {
        base: {
          name: compare, totalRuns: baseRuns.length, passRate: basePassRate,
          healthScore: computeHealthScore(baseRuns),
        },
        delta: {
          passRate: Math.round((detail.summary.passRate - basePassRate) * 10) / 10,
          healthScore: detail.summary.healthScore - computeHealthScore(baseRuns),
        },
      };
    }

    return res.json(detail);
  }

  // Return branch list
  const branches = Object.entries(branchMap)
    .map(([name, brRuns]) => {
      const completed = brRuns.filter(r => r.status === 'completed');
      const passed = completed.filter(r => r.conclusion === 'success').length;
      const failed = completed.filter(r => r.conclusion === 'failure').length;
      const inProgress = brRuns.filter(r => r.status === 'in_progress').length;
      return {
        name, repo: repo || brRuns[0]?.repo || '', totalRuns: brRuns.length,
        passed, failed, inProgress,
        passRate: completed.length > 0 ? Math.round((passed / completed.length) * 1000) / 10 : 0,
        lastRun: brRuns[0]?.startedAt || null,
        lastStatus: brRuns[0]?.conclusion || brRuns[0]?.status || 'unknown',
        healthScore: computeHealthScore(brRuns),
      };
    })
    .sort((a, b) => (b.lastRun || '').localeCompare(a.lastRun || ''));

  res.json({ branches });
});

// GET /api/runs — returns local runs
app.get('/api/runs', (_req, res) => {
  const allRuns = Array.from(runs.values())
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  res.json(allRuns);
});

// GET /api/runs/:id — single run with logs
app.get('/api/runs/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

// GET /api/runs/:id/logs — stream logs
app.get('/api/runs/:id/logs', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ logs: run.logs, status: run.status, conclusion: run.conclusion });
});

// SPA fallback
app.get('/{*path}', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  Dashboard: http://localhost:${PORT}`);
  console.log(`  Mode:      LOCAL (bot runs on this machine)\n`);
  console.log(`  PAT:       ${process.env.GITHUB_PAT ? 'SET ✓' : 'NOT SET'}`);
  console.log(`  Trigger → spawns: npx ts-node src/index.ts <pr_number>\n`);
});
