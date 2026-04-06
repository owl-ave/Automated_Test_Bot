import { DiffFile } from '../../types';
import { Logger } from '../../utils/logger';
import { execSync } from 'child_process';

export class DiffParser {
  private logger = new Logger('DiffParser');
  private repoPath: string;

  constructor(repoPath: string = process.cwd()) {
    this.repoPath = repoPath;
  }

  parsePRDiff(baseBranch: string, headBranch: string): DiffFile[] {
    const execOpts = { cwd: this.repoPath, stdio: 'pipe' as const };
    try {
      // Ensure base branch is available for three-dot diff
      try {
        execSync(`git rev-parse --verify ${baseBranch}`, execOpts);
      } catch {
        try {
          execSync(`git fetch origin ${baseBranch}:${baseBranch}`, { ...execOpts, timeout: 30000 });
        } catch {
          this.logger.warn(`Could not fetch base branch "${baseBranch}", falling back to HEAD~20`);
          // Fall back to diff against recent history
          const diff = execSync(`git log --name-status --pretty=format: -20`, { ...execOpts, encoding: 'utf-8' });
          return this.parseNameStatus(diff);
        }
      }
      const diff = execSync(`git diff ${baseBranch}...${headBranch} --name-status`, { ...execOpts, encoding: 'utf-8' });
      const files: DiffFile[] = [];

      diff.split('\n').forEach((line) => {
        if (!line.trim()) return;
        const [status, path] = line.split('\t');
        if (!path) return;

        files.push({
          path,
          status: status === 'A' ? 'added' : status === 'M' ? 'modified' : 'deleted',
          additions: 0,
          deletions: 0,
          patch: this.getPatchForFile(baseBranch, headBranch, path),
        });
      });

      this.logger.log(`Parsed ${files.length} changed files`);
      return files;
    } catch (error) {
      this.logger.error('Failed to parse diff', error);
      return [];
    }
  }

  private parseNameStatus(output: string): DiffFile[] {
    const files: DiffFile[] = [];
    const seen = new Set<string>();
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      const [status, filePath] = line.split('\t');
      if (!filePath || seen.has(filePath)) continue;
      seen.add(filePath);
      files.push({
        path: filePath,
        status: status === 'A' ? 'added' : status === 'M' ? 'modified' : 'deleted',
        additions: 0,
        deletions: 0,
        patch: '',
      });
    }
    return files;
  }

  private getPatchForFile(baseBranch: string, headBranch: string, filePath: string): string {
    try {
      return execSync(`git diff ${baseBranch}...${headBranch} -- "${filePath}"`, { cwd: this.repoPath, encoding: 'utf-8' });
    } catch {
      return '';
    }
  }
}
