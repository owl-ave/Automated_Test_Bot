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
    context.codeAnalysis.criticalFlows = flowMapper.mapFlows(
      context.codeAnalysis.screens,
      context.codeAnalysis.apiEndpoints,
    );

    const changedScreenNames = context.diffFiles
      .filter((f) => f.path.includes('screen') || f.path.includes('activity') || f.path.includes('viewcontroller'))
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
