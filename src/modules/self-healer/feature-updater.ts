import * as fs from 'fs';
import * as path from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { DiffFile } from '../../types';
import { Logger } from '../../utils/logger';

const logger = new Logger('FeatureUpdater');

export interface UpdateResult {
  filePath: string;
  updated: boolean;
  changes: string;
  originalContent: string;
  newContent: string;
}

async function askClaude(prompt: string): Promise<string> {
  let result = '';
  for await (const message of query({
    prompt,
    options: { maxTurns: 1, model: 'claude-opus-4-6' },
  })) {
    if ('result' in message) result = message.result;
  }
  return result;
}

export class FeatureUpdater {
  async updateFeatureFile(featurePath: string, codeChanges: DiffFile[]): Promise<UpdateResult> {
    const resolvedPath = path.resolve(featurePath);

    if (!fs.existsSync(resolvedPath)) {
      logger.warn('Feature file not found', { path: resolvedPath });
      return {
        filePath: resolvedPath,
        updated: false,
        changes: 'File not found',
        originalContent: '',
        newContent: '',
      };
    }

    const originalContent = fs.readFileSync(resolvedPath, 'utf-8');
    const relevantDiffs = this.filterRelevantChanges(featurePath, codeChanges);

    if (relevantDiffs.length === 0) {
      return {
        filePath: resolvedPath,
        updated: false,
        changes: 'No relevant code changes affect this feature file',
        originalContent,
        newContent: originalContent,
      };
    }

    logger.log('Updating feature file', { path: resolvedPath, relevantDiffs: relevantDiffs.length });

    const diffSummary = relevantDiffs
      .map((d) => `File: ${d.path}\nStatus: ${d.status}\nPatch:\n${d.patch}`)
      .join('\n\n---\n\n');

    try {
      let newContent = await askClaude(
        `A mobile app's code has changed. Update this Gherkin feature file to reflect the changes.

Current feature file:
\`\`\`gherkin
${originalContent}
\`\`\`

Code changes (diffs):
${diffSummary}

Rules:
1. Keep existing scenarios that are still valid
2. Update step text if UI elements changed (renamed buttons, new fields, etc.)
3. Add new scenarios if new functionality was added
4. Remove scenarios for deleted functionality
5. Preserve the Gherkin format (Feature, Scenario, Given/When/Then)
6. Keep scenario names descriptive

Respond with ONLY the updated feature file content (no markdown fences, no explanation).`,
      );

      newContent = newContent
        .replace(/^```gherkin?\n?/m, '')
        .replace(/\n?```$/m, '')
        .trim();

      if (!this.isValidFeatureFile(newContent)) {
        logger.warn('AI-generated feature file failed validation, keeping original');
        return {
          filePath: resolvedPath,
          updated: false,
          changes: 'Generated content failed validation',
          originalContent,
          newContent: originalContent,
        };
      }

      fs.writeFileSync(resolvedPath, newContent + '\n', 'utf-8');

      const changes = this.describeChanges(originalContent, newContent);
      logger.log('Feature file updated', { path: resolvedPath, changes });

      return { filePath: resolvedPath, updated: true, changes, originalContent, newContent };
    } catch (error) {
      logger.error('Feature file update failed', error);
      return {
        filePath: resolvedPath,
        updated: false,
        changes: `Error: ${String(error)}`,
        originalContent,
        newContent: originalContent,
      };
    }
  }

  async updateAllFeatureFiles(featureDir: string, codeChanges: DiffFile[]): Promise<UpdateResult[]> {
    const resolvedDir = path.resolve(featureDir);
    if (!fs.existsSync(resolvedDir)) {
      logger.warn('Feature directory not found', { dir: resolvedDir });
      return [];
    }

    const featureFiles = fs
      .readdirSync(resolvedDir, { recursive: true })
      .filter((f) => String(f).endsWith('.feature'))
      .map((f) => path.join(resolvedDir, String(f)));

    const results: UpdateResult[] = [];
    for (const file of featureFiles) {
      const result = await this.updateFeatureFile(file, codeChanges);
      results.push(result);
    }

    return results;
  }

  private filterRelevantChanges(featurePath: string, diffs: DiffFile[]): DiffFile[] {
    const featureName = path.basename(featurePath, '.feature').toLowerCase();
    const keywords = featureName.split(/[-_\s]+/);

    return diffs.filter((diff) => {
      const diffPath = diff.path.toLowerCase();
      if (this.isUiFile(diffPath)) return true;
      return keywords.some((kw) => kw.length > 2 && diffPath.includes(kw));
    });
  }

  private isUiFile(filePath: string): boolean {
    const uiPatterns = [
      /\.tsx?$/,
      /\.jsx?$/,
      /\.dart$/,
      /\.swift$/,
      /\.kt$/,
      /\.xml$/,
      /screen/i,
      /view/i,
      /component/i,
      /widget/i,
      /activity/i,
      /fragment/i,
      /controller/i,
      /layout/i,
      /storyboard/i,
      /\.xib$/,
    ];
    return uiPatterns.some((p) => p.test(filePath));
  }

  private isValidFeatureFile(content: string): boolean {
    if (!content || content.trim().length === 0) return false;
    const hasFeature = /^\s*Feature:/m.test(content);
    const hasScenario = /^\s*Scenario(?:\s+Outline)?:/m.test(content);
    const hasStep = /^\s*(Given|When|Then|And|But)\s+/m.test(content);
    return hasFeature && hasScenario && hasStep;
  }

  private describeChanges(original: string, updated: string): string {
    const origScenarios = (original.match(/^\s*Scenario(?:\s+Outline)?:/gm) || []).length;
    const newScenarios = (updated.match(/^\s*Scenario(?:\s+Outline)?:/gm) || []).length;
    const origSteps = (original.match(/^\s*(Given|When|Then|And|But)\s+/gm) || []).length;
    const newSteps = (updated.match(/^\s*(Given|When|Then|And|But)\s+/gm) || []).length;

    const parts: string[] = [];
    if (newScenarios !== origScenarios) {
      parts.push(`Scenarios: ${origScenarios} -> ${newScenarios}`);
    }
    if (newSteps !== origSteps) {
      parts.push(`Steps: ${origSteps} -> ${newSteps}`);
    }
    if (parts.length === 0) {
      parts.push('Step text updated (scenario count unchanged)');
    }
    return parts.join(', ');
  }
}
