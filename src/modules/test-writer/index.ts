import { PipelineContext, ModuleResult } from '../../types';
import { StepGenerator } from './step-generator';
import { ElementFinder } from './element-finder';
import { Logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export async function runTestWriter(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('TestWriter');

  if (!context.scenariosBdd || !context.codeAnalysis) {
    return { moduleName: 'TestWriter', status: 'error', error: 'Scenarios or code analysis missing' };
  }

  try {
    const stepGen = new StepGenerator();
    const appiumCode = stepGen.generateAppiumSteps(context.scenariosBdd);

    const outputDir = path.join(process.cwd(), 'step-definitions');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, 'mobile-steps.ts');
    fs.writeFileSync(outputPath, appiumCode);

    logger.log('Test code generated', { file: outputPath, lines: appiumCode.split('\n').length });

    return { moduleName: 'TestWriter', status: 'success', data: { file: outputPath } };
  } catch (error) {
    logger.error('Test code generation failed', error);
    return { moduleName: 'TestWriter', status: 'error', error: String(error) };
  }
}
