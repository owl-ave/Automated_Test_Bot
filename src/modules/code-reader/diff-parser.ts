import { DiffFile } from '../../types';
import { Logger } from '../../utils/logger';
import { execSync } from 'child_process';

export class DiffParser {
  private logger = new Logger('DiffParser');

  parsePRDiff(baseBranch: string, headBranch: string): DiffFile[] {
    try {
      const diff = execSync(`git diff ${baseBranch}...${headBranch} --name-status`, { encoding: 'utf-8' });
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

  private getPatchForFile(baseBranch: string, headBranch: string, filePath: string): string {
    try {
      return execSync(`git diff ${baseBranch}...${headBranch} -- "${filePath}"`, { encoding: 'utf-8' });
    } catch {
      return '';
    }
  }
}
