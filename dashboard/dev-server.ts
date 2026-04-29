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
import jwt from 'jsonwebtoken';

async function mintInstallationToken(appId: string, privateKey: string, installationId?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwtToken = jwt.sign(
    { iat: now - 60, exp: now + 9 * 60, iss: appId },
    privateKey,
    { algorithm: 'RS256' },
  );
  const ghHeaders = { Authorization: `Bearer ${jwtToken}`, Accept: 'application/vnd.github+json' };

  if (!installationId) {
    const { data } = await axios.get('https://api.github.com/app/installations', { headers: ghHeaders });
    if (!data.length) throw new Error('No GitHub App installations found');
    installationId = String(data[0].id);
  }
  const { data } = await axios.post(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {},
    { headers: ghHeaders },
  );
  return data.token;
}

const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT || '3333', 10);
const BOT_REPO = process.env.BOT_REPO || 'owl-ave/Automated_Test_Bot';
const WORKFLOW_FILE = 'test-bot.yml';

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', express.json());
app.use('/api', (req, _res, next) => {
  const t0 = Date.now();
  const orig = _res.end.bind(_res);
  (_res as any).end = (...args: any[]) => {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${req.method} ${req.originalUrl} ${_res.statusCode} ${Date.now() - t0}ms`);
    return (orig as any)(...args);
  };
  next();
});

function resolveAppPrivateKey(): string | null {
  const b64 = process.env.APP_PRIVATE_KEY_B64 || process.env.GITHUB_APP_PRIVATE_KEY_B64;
  if (b64) return Buffer.from(b64, 'base64').toString('utf8');
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (raw) return raw.replace(/\\n/g, '\n');
  return null;
}

let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;

async function getToken(): Promise<string> {
  const pat = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
  if (pat) return pat;

  const appId = process.env.APP_ID || process.env.GITHUB_APP_ID;
  const privateKey = resolveAppPrivateKey();
  const installationId = process.env.APP_INSTALLATION_ID || process.env.GITHUB_APP_INSTALLATION_ID;

  if (!appId || !privateKey) {
    throw new Error('No GitHub auth: set GITHUB_TOKEN, or APP_ID + APP_PRIVATE_KEY_B64');
  }

  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt) return cachedToken;

  const token = await mintInstallationToken(appId, privateKey, installationId);
  cachedToken = token;
  cachedTokenExpiresAt = now + 55 * 60 * 1000;
  return token;
}

function authMode(): string {
  if (process.env.GITHUB_PAT || process.env.GITHUB_TOKEN) return 'PAT ✓';
  if ((process.env.APP_ID || process.env.GITHUB_APP_ID) && resolveAppPrivateKey()) return 'GitHub App ✓';
  return 'NOT SET ✗';
}

const gh = (token: string) => ({
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'TestingBot-Dashboard',
});

// GET /api/repos
app.get('/api/repos', async (_req, res) => {
  try {
    const isApp = !(process.env.GITHUB_PAT || process.env.GITHUB_TOKEN);
    const url = isApp
      ? 'https://api.github.com/installation/repositories?per_page=100'
      : 'https://api.github.com/user/repos?per_page=100&sort=updated';
    const { data } = await axios.get(url, { headers: gh(await getToken()) });
    const list = isApp ? (data.repositories || []) : data;
    res.json(list.map((r: any) => ({
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
      { headers: gh(await getToken()) }
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
    const token = await getToken();
    const runsUrl = `https://api.github.com/repos/${botOwner}/${botRepo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`;

    // Capture the latest run ID before dispatch so we can detect the new one
    const before = await axios.get(runsUrl, { headers: gh(token) });
    const beforeId = Number(before.data.workflow_runs?.[0]?.id || 0);

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
      { headers: gh(token) }
    );

    // Poll for the newly created run (typically appears within 1-3s)
    let runId: string | null = null;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const after = await axios.get(runsUrl, { headers: gh(token) });
      const latest = after.data.workflow_runs?.[0];
      if (latest && Number(latest.id) > beforeId) {
        runId = String(latest.id);
        break;
      }
    }

    res.json({
      status: 'triggered',
      runId,
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
      { headers: gh(await getToken()) }
    );

    const token = await getToken();
    const runs = await Promise.all((data.workflow_runs || []).map(async (r: any) => {
      const parsed = parseDisplayTitle(r.display_title || '');
      let repo = r.inputs?.repo || parsed.repo;
      let branch = r.inputs?.branch || parsed.branch;
      let prNumber = r.inputs?.pr_number ? parseInt(r.inputs.pr_number) || null : parsed.prNumber;

      // If still unresolved, fetch from job logs (cached)
      if (!repo) {
        const meta = await resolveRunMeta(String(r.id), token, botOwner, botRepo);
        repo = meta.repo;
        branch = branch || meta.branch;
        prNumber = prNumber || meta.prNumber;
      }

      return {
        id: String(r.id),
        repo: repo || r.display_title || '',
        prNumber,
        branch: branch || r.head_branch || 'main',
        status: mapStatus(r.status),
        conclusion: r.conclusion === 'success' ? 'success' : r.conclusion === 'failure' ? 'failure' : r.conclusion === 'cancelled' ? 'cancelled' : undefined,
        startedAt: r.created_at,
        completedAt: r.updated_at || null,
        triggeredBy: r.triggering_actor?.login || 'dashboard',
        url: r.html_url,
      };
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

// Parse run-name format: "test owner/repo @ branch PR#123"
function parseDisplayTitle(title: string): { repo: string; branch: string; prNumber: number | null } {
  const match = title.match(/^test\s+(\S+)\s+@\s+(\S+)(?:\s+PR#(\d+))?$/);
  if (match) {
    return { repo: match[1], branch: match[2], prNumber: match[3] ? parseInt(match[3]) : null };
  }
  return { repo: '', branch: '', prNumber: null };
}

// Cache for run metadata parsed from job logs
const runMetaCache = new Map<string, { repo: string; branch: string; prNumber: number | null }>();

async function resolveRunMeta(
  runId: string, token: string, botOwner: string, botRepo: string
): Promise<{ repo: string; branch: string; prNumber: number | null }> {
  if (runMetaCache.has(runId)) return runMetaCache.get(runId)!;

  try {
    // Fetch jobs for this run, find the "detect" job
    const { data: jobsData } = await axios.get(
      `https://api.github.com/repos/${botOwner}/${botRepo}/actions/runs/${runId}/jobs`,
      { headers: gh(token) }
    );
    const detectJob = (jobsData.jobs || []).find((j: any) => j.name === 'detect');
    if (!detectJob) return { repo: '', branch: 'main', prNumber: null };

    // Fetch logs for the detect job — contains "IFS='/' read -r owner repo <<< "owner/repo""
    const logRes = await axios.get(
      `https://api.github.com/repos/${botOwner}/${botRepo}/actions/jobs/${detectJob.id}/logs`,
      { headers: gh(token), maxRedirects: 5, responseType: 'text' }
    );
    const logText = String(logRes.data);

    // Parse repo from: IFS='/' read -r owner repo <<< "owner/repo"
    const repoMatch = logText.match(/read -r owner repo <<< "([^"]+)"/);
    // Parse ref from checkout step: "ref: refs/pull/8/head" or "ref: main"
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

    const meta = {
      repo: repoMatch ? repoMatch[1] : '',
      branch,
      prNumber,
    };
    runMetaCache.set(runId, meta);
    return meta;
  } catch {
    return { repo: '', branch: 'main', prNumber: null };
  }
}

// GET /api/runs/:id — single run details
app.get('/api/runs/:id', async (req, res) => {
  const [botOwner, botRepo] = BOT_REPO.split('/');
  try {
    const { data: r } = await axios.get(
      `https://api.github.com/repos/${botOwner}/${botRepo}/actions/runs/${req.params.id}`,
      { headers: gh(await getToken()) }
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
  const token = await getToken();

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
    const jobs = jobsData.jobs || [];

    // Fetch all job logs in parallel with a 3s timeout each
    const jobLogResults = await Promise.all(jobs.map(async (job: any) => {
      try {
        const logRes = await axios.get(
          `https://api.github.com/repos/${botOwner}/${botRepo}/actions/jobs/${job.id}/logs`,
          { headers: gh(token), maxRedirects: 5, responseType: 'text', timeout: 3000 }
        );
        const lines = String(logRes.data).split('\n');
        return { job, lines: lines.slice(-50), error: null };
      } catch (e: any) {
        return { job, lines: [] as string[], error: e.response?.status || e.code || 'error' };
      }
    }));

    for (const { job, lines, error } of jobLogResults) {
      logs.push(`\n=== Job: ${job.name} [${job.status}${job.conclusion ? '/' + job.conclusion : ''}] ===`);
      for (const step of (job.steps || [])) {
        const icon = step.conclusion === 'success' ? '✓' : step.conclusion === 'failure' ? '✗' : '○';
        logs.push(`  ${icon} ${step.name}`);
      }
      if (lines.length) {
        lines.forEach((l: string) => logs.push(l));
      } else if (error) {
        logs.push(job.status === 'completed'
          ? `  [Logs unavailable: ${error}]`
          : `  [Logs not yet available — runner is still warming up]`);
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
      { headers: gh(await getToken()) }
    );

    const token = await getToken();
    const allRuns = (await Promise.all((data.workflow_runs || []).map(async (r: any) => {
      const parsed = parseDisplayTitle(r.display_title || '');
      let repo = r.inputs?.repo || parsed.repo;
      let branch = r.inputs?.branch || parsed.branch;
      let prNumber = r.inputs?.pr_number ? parseInt(r.inputs.pr_number) || null : parsed.prNumber;

      if (!repo) {
        const meta = await resolveRunMeta(String(r.id), token, botOwner, botRepo);
        repo = meta.repo;
        branch = branch || meta.branch;
        prNumber = prNumber || meta.prNumber;
      }

      return {
        id: String(r.id),
        repo: repo || '',
        branch: branch || 'main',
        status: mapStatus(r.status),
        conclusion: r.conclusion,
        startedAt: r.created_at,
        prNumber,
        triggeredBy: r.triggering_actor?.login || 'dashboard',
      };
    }))).filter((r: any) => !filterRepo || r.repo === filterRepo);

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
  console.log(`  Auth:      ${authMode()}\n`);
});
