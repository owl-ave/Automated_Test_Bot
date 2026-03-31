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
