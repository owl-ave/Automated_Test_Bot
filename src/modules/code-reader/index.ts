import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { PipelineContext, ModuleResult, AuthConfig } from '../../types';
import { DiffParser } from './diff-parser';
import { RepoScanner } from './repo-scanner';
import { Logger } from '../../utils/logger';

export async function runCodeReader(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('CodeReader');

  try {
    let repoPath = context.targetPath || process.cwd();
    const repoSlug = `${context.repoOwner}/${context.repoName}`;

    // Check if target repo is already checked out (CI workflow checks it out to target/)
    const hasGitDir = fs.existsSync(path.join(repoPath, '.git'));

    if (hasGitDir) {
      logger.log('Using pre-checked-out target repo', { path: repoPath });
      // Ensure we're on the PR branch, not just main
      if (context.branch && context.branch !== 'main') {
        try {
          execSync(`git fetch origin ${context.branch} && git checkout ${context.branch}`, { cwd: repoPath, stdio: 'pipe' });
          logger.log('Checked out PR branch', { branch: context.branch });
        } catch {
          logger.warn('Could not checkout PR branch, using current branch');
        }
      }
    } else if (context.repoOwner && context.repoName) {
      // Not checked out — clone it (local dev mode)
      const cloneDir = path.join(repoPath, '.tmp-repos', context.repoName);

      if (!fs.existsSync(cloneDir)) {
        logger.log('Cloning target repo', { repo: repoSlug });
        fs.mkdirSync(path.dirname(cloneDir), { recursive: true });

        const token = process.env.GITHUB_TOKEN || '';
        const cloneUrl = token
          ? `https://x-access-token:${token}@github.com/${repoSlug}.git`
          : `https://github.com/${repoSlug}.git`;

        const branchFlag = context.branch ? `-b ${context.branch}` : '';
        try {
          execSync(`git clone --depth 50 ${branchFlag} ${cloneUrl} "${cloneDir}"`, { stdio: 'pipe' });
          logger.log('Repo cloned', { path: cloneDir, branch: context.branch });
        } catch (err) {
          const scrubbed = scrubToken(err, token);
          throw new Error(`git clone failed: ${scrubbed}`);
        }
      } else {
        logger.log('Using cached repo clone', { path: cloneDir });
        try {
          execSync('git pull --ff-only', { cwd: cloneDir, stdio: 'pipe' });
        } catch (err) {
          logger.debug('git pull --ff-only failed (continuing with cached clone)', {
            error: String(err).slice(0, 200),
          });
        }
      }

      repoPath = cloneDir;
    }

    // Parse PR diff — run git commands in the target repo, not the bot directory
    const diffParser = new DiffParser(repoPath);
    const diffFiles = diffParser.parsePRDiff('main', context.branch);

    // If git diff failed (no git repo or same branch), try GitHub API
    if (diffFiles.length === 0 && context.repoOwner && context.prNumber > 0) {
      logger.log('Git diff empty, fetching from GitHub API');
      try {
        const axios = (await import('axios')).default;
        const token = process.env.GITHUB_TOKEN || '';
        const { data } = await axios.get(
          `https://api.github.com/repos/${repoSlug}/pulls/${context.prNumber}/files`,
          { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TestingBot' } },
        );
        for (const file of data) {
          diffFiles.push({
            path: file.filename,
            status: file.status === 'added' ? 'added' : file.status === 'removed' ? 'deleted' : 'modified',
            additions: file.additions || 0,
            deletions: file.deletions || 0,
            patch: file.patch || '',
          });
        }
        logger.log('Fetched diff from GitHub API', { files: diffFiles.length });
      } catch (err) {
        logger.warn('GitHub API diff fetch failed', err);
      }
    }

    // Scan repo structure — pass diff file paths so framework can be detected from them
    // if the filesystem scan returns nothing (e.g. brand-new repo with all files "added")
    const scanner = new RepoScanner(repoPath);
    const codeAnalysis = scanner.scan(diffFiles.map((f) => f.path));

    context.diffFiles = diffFiles;
    context.codeAnalysis = codeAnalysis;
    context.mobilePath = codeAnalysis.mobilePath;

    // Read bot-test-config.json from the checked-out repo root
    const botConfigPath = path.join(repoPath, 'bot-test-config.json');
    if (fs.existsSync(botConfigPath)) {
      try {
        const raw = fs.readFileSync(botConfigPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const auth = parsed?.auth;
        const validTypes: AuthConfig['type'][] = ['email_password', 'phone_otp', 'username_password', 'guest', 'none'];
        if (auth && typeof auth.type === 'string' && validTypes.includes(auth.type)) {
          context.authConfig = {
            type: auth.type,
            ...(auth.email    && { email: String(auth.email) }),
            ...(auth.password && { password: String(auth.password) }),
            ...(auth.phone    && { phone: String(auth.phone) }),
            ...(auth.username && { username: String(auth.username) }),
          };
          logger.log('Auth config loaded', { type: auth.type }); // never log values
        } else {
          logger.warn('bot-test-config.json found but auth.type missing or invalid', { found: auth?.type ?? 'undefined' });
        }
      } catch (err) {
        logger.warn('Failed to parse bot-test-config.json — auth tests will be skipped', err);
      }
    } else {
      logger.log('No bot-test-config.json found — auth tests will be skipped');
    }

    logger.log('Code reading complete', { repoPath, filesChanged: diffFiles.length, framework: codeAnalysis.framework, screens: codeAnalysis.screens.length });

    return { moduleName: 'CodeReader', status: 'success', data: { diffFiles, codeAnalysis } };
  } catch (error) {
    logger.error('Code reading failed', error);
    return { moduleName: 'CodeReader', status: 'error', error: String(error) };
  }
}

function scrubToken(err: unknown, token: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (token && msg.includes(token)) msg = msg.split(token).join('***');
  // Also catch the `x-access-token:<anything>@github.com` form to cover any unknown token that
  // got interpolated via URL.
  msg = msg.replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
  return msg.slice(0, 500);
}
