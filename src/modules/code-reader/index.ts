import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { PipelineContext, ModuleResult } from '../../types';
import { DiffParser } from './diff-parser';
import { RepoScanner } from './repo-scanner';
import { Logger } from '../../utils/logger';

export async function runCodeReader(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('CodeReader');

  try {
    // Use target repo path if set (CI), otherwise fall back to cwd
    let repoPath = context.targetPath || process.cwd();
    const repoSlug = `${context.repoOwner}/${context.repoName}`;

    // If GITHUB_REPOSITORY doesn't match current dir, clone the target repo
    const currentPackage = path.join(repoPath, 'package.json');
    const isTargetRepo = fs.existsSync(currentPackage) && fs.readFileSync(currentPackage, 'utf-8').includes(context.repoName);

    if (!isTargetRepo && context.repoOwner && context.repoName) {
      const cloneDir = path.join(repoPath, '.tmp-repos', context.repoName);

      if (!fs.existsSync(cloneDir)) {
        logger.log('Cloning target repo', { repo: repoSlug });
        fs.mkdirSync(path.dirname(cloneDir), { recursive: true });

        const token = process.env.GITHUB_TOKEN || '';
        const cloneUrl = token
          ? `https://x-access-token:${token}@github.com/${repoSlug}.git`
          : `https://github.com/${repoSlug}.git`;

        // Clone with the PR branch directly if available
        const cloneBranch = context.branch && context.branch !== 'main' ? context.branch : '';
        const branchFlag = cloneBranch ? `-b ${cloneBranch}` : '';
        execSync(`git clone --depth 50 ${branchFlag} ${cloneUrl} "${cloneDir}"`, { stdio: 'pipe' });
        if (cloneBranch) logger.log('Cloned PR branch directly', { branch: cloneBranch });

        logger.log('Repo cloned', { path: cloneDir });
      } else {
        logger.log('Using cached repo clone', { path: cloneDir });
        try {
          execSync('git pull --ff-only', { cwd: cloneDir, stdio: 'pipe' });
        } catch {
          // pull might fail if detached, that's ok
        }
      }

      repoPath = cloneDir;
    }

    // Parse PR diff
    const diffParser = new DiffParser();
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

    // Scan repo structure
    const scanner = new RepoScanner(repoPath);
    const codeAnalysis = scanner.scan();

    context.diffFiles = diffFiles;
    context.codeAnalysis = codeAnalysis;

    logger.log('Code reading complete', { repoPath, filesChanged: diffFiles.length, framework: codeAnalysis.framework, screens: codeAnalysis.screens.length });

    return { moduleName: 'CodeReader', status: 'success', data: { diffFiles, codeAnalysis } };
  } catch (error) {
    logger.error('Code reading failed', error);
    return { moduleName: 'CodeReader', status: 'error', error: String(error) };
  }
}
