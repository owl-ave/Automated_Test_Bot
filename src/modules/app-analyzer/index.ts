import { PipelineContext, ModuleResult } from '../../types';
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

    const isUiFile = (filePath: string): boolean => {
      const lower = filePath.toLowerCase();
      const uiPatterns = ['screen', 'activity', 'fragment', 'composable', 'viewcontroller', 'controller'];
      if (uiPatterns.some((p) => lower.includes(p))) return true;
      if (lower.endsWith('.storyboard') || lower.endsWith('.xib')) return true;
      if (lower.includes('res/layout') && lower.endsWith('.xml')) return true;
      if (lower.endsWith('.swift') && lower.includes('view')) return true;
      return false;
    };

    const changedScreenNames = context.diffFiles
      .filter((f) => isUiFile(f.path))
      .map((f) => f.path.split('/').pop() || '');

    context.codeAnalysis.criticalFlows = flowMapper.identifyAffectedFlows(
      context.codeAnalysis.criticalFlows,
      changedScreenNames,
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
