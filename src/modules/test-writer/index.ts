import * as fs from 'fs';
import * as path from 'path';
import { PipelineContext, ModuleResult } from '../../types';
import { resolveAppId } from './maestro-flow-generator';
import { validateMaestroFlow, validateRun } from './maestro-validator';
import { Logger } from '../../utils/logger';

// ScenarioBrain now emits MaestroFlow[] directly — there's no Gherkin
// intermediate to convert. TestWriter is reduced to:
//   1. Run pre-flight validator (12 common-AI-mistake checks).
//   2. Block submission if any error-severity issues remain.
//   3. Write the YAML files to disk for inspection / archive.
// The runner picks the flows up from `context.maestroFlows` after this step.
export async function runTestWriter(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('TestWriter');

  const flows = context.maestroFlows ?? [];
  if (flows.length === 0) {
    return { moduleName: 'TestWriter', status: 'error', error: 'No Maestro flows in context — ScenarioBrain produced nothing' };
  }
  if (!context.codeAnalysis) {
    return { moduleName: 'TestWriter', status: 'error', error: 'codeAnalysis missing' };
  }

  try {
    const expectedAppIds = resolveAppId(context.codeAnalysis.framework, context.mobilePath);
    const validated = flows.map((f) => ({
      ...f,
      issues: validateMaestroFlow(f, { codeAnalysis: context.codeAnalysis!, expectedAppIds }),
    }));
    const runIssues = validateRun(validated);

    const blockingErrors = validated.flatMap((f) =>
      f.issues.filter((i) => i.severity === 'error').map((i) => `${f.scenario}: [${i.check}] ${i.message}`),
    );
    if (blockingErrors.length > 0) {
      logger.error('Maestro validator blocked submission', { errors: blockingErrors });
      return {
        moduleName: 'TestWriter',
        status: 'error',
        error: `Validator blocked ${blockingErrors.length} flow(s):\n${blockingErrors.join('\n')}`,
      };
    }

    const outputDir = path.join(process.cwd(), 'features', 'maestro');
    fs.mkdirSync(outputDir, { recursive: true });
    for (const f of validated) {
      fs.writeFileSync(path.join(outputDir, f.fileName), f.yaml);
    }

    // Mutate context in-place so downstream BrowserStack/Reporter modules see
    // the validator-stamped flows (with issue lists attached).
    context.maestroFlows = validated;

    const totalWarnings =
      validated.reduce((acc, f) => acc + f.issues.filter((i) => i.severity === 'warn').length, 0) + runIssues.length;
    logger.log('Maestro flows validated and persisted', {
      flows: validated.length,
      outputDir,
      warnings: totalWarnings,
    });

    return {
      moduleName: 'TestWriter',
      status: 'success',
      data: {
        outputDir,
        flowCount: validated.length,
        warnings: validated.flatMap((f) => f.issues).concat(runIssues),
      },
    };
  } catch (error) {
    logger.error('Maestro flow validation/write failed', error);
    return { moduleName: 'TestWriter', status: 'error', error: String(error) };
  }
}
