import * as path from 'path';
import { PipelineContext, ModuleResult, Screen } from '../../types';
import { IndustryDetector } from './industry-detector';
import { FlowMapper } from './flow-mapper';
import { Logger } from '../../utils/logger';

export async function runAppAnalyzer(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('AppAnalyzer');

  if (!context.codeAnalysis) {
    return { moduleName: 'AppAnalyzer', status: 'error', error: 'CodeAnalysis missing' };
  }

  try {
    const industryDetector = new IndustryDetector();
    context.codeAnalysis.industry = await industryDetector.detect(context.codeAnalysis);

    const flowMapper = new FlowMapper();
    context.codeAnalysis.criticalFlows = await flowMapper.mapFlows(
      context.codeAnalysis.screens,
      context.codeAnalysis.apiEndpoints,
    );

    const changedScreens = resolveChangedScreens(
      context.diffFiles.map((f) => f.path),
      context.codeAnalysis.screens,
      context.mobilePath,
    );
    if (changedScreens.size === 0 && context.diffFiles.length > 0) {
      logger.log('No diff files mapped to known screens', {
        diffCount: context.diffFiles.length,
        screenCount: context.codeAnalysis.screens.length,
      });
    } else if (changedScreens.size > 0) {
      logger.log('Diff files mapped to screens', {
        screens: Array.from(changedScreens),
      });
    }

    context.codeAnalysis.criticalFlows = flowMapper.identifyAffectedFlows(
      context.codeAnalysis.criticalFlows,
      Array.from(changedScreens),
    );

    logger.log('App analysis complete', {
      industry: context.codeAnalysis.industry,
      flows: context.codeAnalysis.criticalFlows.length,
    });

    return { moduleName: 'AppAnalyzer', status: 'success', data: context.codeAnalysis };
  } catch (error) {
    logger.error('App analysis failed', error);
    return { moduleName: 'AppAnalyzer', status: 'error', error: String(error) };
  }
}

// Maps changed file paths back to screen names using the AppAnalyzer screen
// catalog. Two strategies, in order of confidence:
//   1. Exact path match (catalog stores absolute paths; diff stores repo-relative).
//      We try both forms and the absolute form joined under mobilePath.
//   2. Basename-without-extension match. Catches cases where the catalog and the
//      diff disagree on path roots (e.g. nested module dirs) but the file name
//      uniquely identifies the screen.
// Returns the set of screen *names* (so they can be compared directly against
// FlowMapper's flow.screens entries, which are also names).
function resolveChangedScreens(
  diffPaths: string[],
  screens: Screen[],
  mobilePath?: string,
): Set<string> {
  const matched = new Set<string>();

  const byAbsPath = new Map<string, string>();
  const byBasename = new Map<string, string>();
  for (const screen of screens) {
    if (screen.path) byAbsPath.set(path.resolve(screen.path), screen.name);
    const base = path.basename(screen.path || screen.name);
    const stem = base.replace(/\.[^.]+$/, '');
    if (stem) byBasename.set(stem.toLowerCase(), screen.name);
  }

  for (const diffPath of diffPaths) {
    const abs = path.resolve(mobilePath ? path.join(mobilePath, '..', diffPath) : diffPath);
    if (byAbsPath.has(abs)) {
      matched.add(byAbsPath.get(abs)!);
      continue;
    }
    // Fallback: basename without extension. Diff paths end in ".swift" / ".kt" /
    // ".tsx"; screen names are bare symbols (e.g. "TransactionDetailView").
    const stem = path.basename(diffPath).replace(/\.[^.]+$/, '').toLowerCase();
    const hit = byBasename.get(stem);
    if (hit) matched.add(hit);
  }

  return matched;
}
