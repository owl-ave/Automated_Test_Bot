import { PipelineContext, ModuleResult } from '../../types';
import { FeatureGenerator } from './feature-generator';
import { Logger } from '../../utils/logger';

export async function runScenarioBrain(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('ScenarioBrain');

  if (!context.codeAnalysis || !process.env.CLAUDE_AUTH_TOKEN) {
    return { moduleName: 'ScenarioBrain', status: 'error', error: 'Missing analysis or auth token' };
  }

  try {
    const generator = new FeatureGenerator();
    const scenarios = await generator.generateFeatures(
      context.codeAnalysis.industry,
      context.codeAnalysis.criticalFlows,
    );

    context.scenariosBdd = scenarios;

    logger.log('Feature generation complete', { scenarios: scenarios.length });
    return { moduleName: 'ScenarioBrain', status: 'success', data: scenarios };
  } catch (error) {
    logger.error('Feature generation failed', error);
    return { moduleName: 'ScenarioBrain', status: 'error', error: String(error) };
  }
}
