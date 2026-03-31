import { DiffFile, TestResult } from '../../types';
import { Logger } from '../../utils/logger';

export interface CoverageReport {
  totalChangedLines: number;
  coveredLines: number;
  uncoveredLines: UncoveredLine[];
  coveragePercentage: number;
  fileReports: FileCoverageReport[];
  summary: string;
}

export interface FileCoverageReport {
  path: string;
  changedLines: number[];
  coveredLines: number[];
  uncoveredLines: number[];
  coveragePercentage: number;
}

export interface UncoveredLine {
  file: string;
  line: number;
  content: string;
}

export class CoverageTracker {
  private logger = new Logger('CoverageTracker');

  trackCoverage(diffFiles: DiffFile[], testResults: TestResult[]): CoverageReport {
    const fileReports: FileCoverageReport[] = [];
    let totalChanged = 0;
    let totalCovered = 0;
    const allUncoveredLines: UncoveredLine[] = [];

    for (const diff of diffFiles) {
      if (diff.status === 'deleted') continue;
      if (!this.isTestableFile(diff.path)) continue;

      const changedLines = this.extractChangedLines(diff.patch);
      if (changedLines.length === 0) continue;

      const coveredLines = this.determineCoveredLines(diff, changedLines, testResults);
      const uncoveredLines = changedLines.filter((l) => !coveredLines.includes(l));

      const fileReport: FileCoverageReport = {
        path: diff.path,
        changedLines,
        coveredLines,
        uncoveredLines,
        coveragePercentage:
          changedLines.length > 0 ? Math.round((coveredLines.length / changedLines.length) * 100) : 100,
      };

      fileReports.push(fileReport);
      totalChanged += changedLines.length;
      totalCovered += coveredLines.length;

      for (const line of uncoveredLines) {
        const content = this.extractLineContent(diff.patch, line);
        allUncoveredLines.push({ file: diff.path, line, content });
      }
    }

    const coveragePercentage = totalChanged > 0 ? Math.round((totalCovered / totalChanged) * 100) : 100;

    const report: CoverageReport = {
      totalChangedLines: totalChanged,
      coveredLines: totalCovered,
      uncoveredLines: allUncoveredLines,
      coveragePercentage,
      fileReports,
      summary: this.buildSummary(coveragePercentage, fileReports, allUncoveredLines),
    };

    this.logger.log('Coverage tracking complete', {
      totalChanged,
      totalCovered,
      coveragePercentage,
      filesAnalyzed: fileReports.length,
      uncoveredLineCount: allUncoveredLines.length,
    });

    return report;
  }

  private isTestableFile(filePath: string): boolean {
    const testableExtensions = [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.dart',
      '.swift',
      '.kt',
      '.kts',
      '.java',
      '.m',
      '.mm',
      '.vue',
      '.svelte',
    ];
    const lowerPath = filePath.toLowerCase();

    // Skip test files themselves, configs, and assets
    if (/\.(test|spec|e2e|mock)\./i.test(lowerPath)) return false;
    if (/__(tests|mocks|snapshots)__/i.test(lowerPath)) return false;
    if (/\.(json|xml|yaml|yml|md|txt|css|scss|less|svg|png|jpg)$/i.test(lowerPath)) return false;
    if (/config|\.env|\.eslint|\.prettier|tsconfig/i.test(lowerPath)) return false;

    return testableExtensions.some((ext) => lowerPath.endsWith(ext));
  }

  private extractChangedLines(patch: string): number[] {
    const lines: number[] = [];
    if (!patch) return lines;

    const patchLines = patch.split('\n');
    let currentLine = 0;

    for (const line of patchLines) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1], 10);
        continue;
      }

      if (line.startsWith('+') && !line.startsWith('+++')) {
        // Added line
        lines.push(currentLine);
        currentLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Deleted line -- don't increment current line number
      } else {
        // Context line
        currentLine++;
      }
    }

    return lines;
  }

  private determineCoveredLines(diff: DiffFile, changedLines: number[], testResults: TestResult[]): number[] {
    const covered: number[] = [];
    const filePath = diff.path.toLowerCase();

    // Extract the screen/component name from the file path
    const fileName = this.extractComponentName(filePath);

    // Check which test scenarios reference this file or component
    const relevantTests = testResults.filter((tr) => {
      const scenarioLower = tr.scenario.toLowerCase();
      return scenarioLower.includes(fileName) || this.componentMatchesScenario(filePath, scenarioLower);
    });

    if (relevantTests.length === 0) {
      return covered;
    }

    const hasPassingTest = relevantTests.some((t) => t.status === 'pass');
    const hasAnyExecution = relevantTests.length > 0;

    for (const line of changedLines) {
      const lineContent = this.extractLineContent(diff.patch, line);

      // Skip non-executable lines (imports, comments, blank lines, type definitions)
      if (this.isNonExecutableLine(lineContent)) {
        covered.push(line);
        continue;
      }

      // If tests passed that reference this component, mark lines as covered
      if (hasPassingTest) {
        covered.push(line);
      } else if (hasAnyExecution && this.isLineInTestedPath(lineContent)) {
        // Even failing tests might exercise error paths
        covered.push(line);
      }
    }

    return covered;
  }

  private extractComponentName(filePath: string): string {
    const segments = filePath.replace(/\\/g, '/').split('/');
    const fileName = segments[segments.length - 1] || '';
    return fileName
      .replace(/\.\w+$/, '')
      .replace(/[-_]/g, '')
      .toLowerCase();
  }

  private componentMatchesScenario(filePath: string, scenario: string): boolean {
    const pathParts = filePath.replace(/\\/g, '/').split('/');

    // Check if any path segment (directory or file name) appears in the scenario
    for (const part of pathParts) {
      const cleaned = part
        .replace(/\.\w+$/, '')
        .replace(/[-_]/g, ' ')
        .toLowerCase();
      if (cleaned.length > 2 && scenario.includes(cleaned)) return true;
    }

    return false;
  }

  private isNonExecutableLine(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed) return true;
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#'))
      return true;
    if (trimmed.startsWith('import ') || trimmed.startsWith('export type') || trimmed.startsWith('export interface'))
      return true;
    if (/^(interface|type|enum)\s/.test(trimmed)) return true;
    if (trimmed === '{' || trimmed === '}' || trimmed === ');' || trimmed === ')') return true;
    return false;
  }

  private isLineInTestedPath(content: string): boolean {
    const trimmed = content.trim().toLowerCase();
    // Error handling paths might be covered by failing tests
    return /catch|error|throw|reject|fail|invalid/i.test(trimmed);
  }

  private extractLineContent(patch: string, targetLine: number): string {
    if (!patch) return '';
    const patchLines = patch.split('\n');
    let currentLine = 0;

    for (const line of patchLines) {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1], 10);
        continue;
      }

      if (line.startsWith('+') && !line.startsWith('+++')) {
        if (currentLine === targetLine) {
          return line.substring(1); // Remove the leading '+'
        }
        currentLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Deleted line
      } else {
        currentLine++;
      }
    }

    return '';
  }

  private buildSummary(percentage: number, fileReports: FileCoverageReport[], uncoveredLines: UncoveredLine[]): string {
    const parts: string[] = [];
    parts.push(`Overall coverage: ${percentage}%`);

    const lowCoverage = fileReports.filter((f) => f.coveragePercentage < 50);
    if (lowCoverage.length > 0) {
      parts.push(`Files with low coverage (<50%): ${lowCoverage.map((f) => f.path).join(', ')}`);
    }

    const zeroCoverage = fileReports.filter((f) => f.coveragePercentage === 0 && f.changedLines.length > 0);
    if (zeroCoverage.length > 0) {
      parts.push(`Untested files: ${zeroCoverage.map((f) => f.path).join(', ')}`);
    }

    if (uncoveredLines.length > 0) {
      parts.push(`${uncoveredLines.length} changed lines not covered by tests`);
    }

    return parts.join('. ');
  }
}
