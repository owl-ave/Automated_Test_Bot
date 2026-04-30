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
  if (!context.codeAnalysis) {
    return { moduleName: 'TestWriter', status: 'error', error: 'codeAnalysis missing' };
  }
  // Zero flows is a legitimate state (PR touches no testable surface, or every
  // generated flow needed creds the bot doesn't have). Don't abort the pipeline —
  // let downstream skip and Reporter post a "no flows tested" comment.
  if (flows.length === 0) {
    logger.warn('No Maestro flows to write — pipeline will skip execution and report "no flows tested"');
    context.maestroFlows = [];
    return { moduleName: 'TestWriter', status: 'success', data: [] };
  }

  try {
    const expectedAppIds = resolveAppId(context.codeAnalysis.framework, context.mobilePath);
    const validated = flows.map((f) => ({
      ...f,
      issues: validateMaestroFlow(f, { codeAnalysis: context.codeAnalysis!, expectedAppIds }),
    }));
    const runIssues = validateRun(validated);

    // Partition: clean flows go to BS, broken flows are dropped (not the whole
    // suite). Old behaviour aborted the entire pipeline if any flow had an
    // error — run #71 dropped 53 good flows because of 11 bad ones, which is
    // worse than running the 53 and reporting "11 flows skipped: <reason>".
    const cleanFlows: typeof validated = [];
    const droppedFlows: { scenario: string; errors: string[] }[] = [];
    for (const f of validated) {
      const errs = f.issues.filter((i) => i.severity === 'error');
      if (errs.length === 0) {
        cleanFlows.push(f);
      } else {
        droppedFlows.push({
          scenario: f.scenario,
          errors: errs.map((i) => `[${i.check}] ${i.message}`),
        });
      }
    }

    if (droppedFlows.length > 0) {
      logger.warn(`Validator dropped ${droppedFlows.length} flow(s); continuing with ${cleanFlows.length}`, {
        dropped: droppedFlows,
      });
    }

    if (cleanFlows.length === 0) {
      return {
        moduleName: 'TestWriter',
        status: 'error',
        error: `Validator rejected all ${validated.length} flow(s); nothing to submit. First failure: ${
          droppedFlows[0]?.scenario ?? 'unknown'
        } — ${droppedFlows[0]?.errors.join('; ') ?? 'no detail'}`,
      };
    }

    const outputDir = path.join(process.cwd(), 'features', 'maestro');
    fs.mkdirSync(outputDir, { recursive: true });
    for (const f of cleanFlows) {
      fs.writeFileSync(path.join(outputDir, f.fileName), f.yaml);
    }

    // Mutate context in-place so downstream BrowserStack/Reporter modules see
    // the validator-stamped flows (with issue lists attached).
    context.maestroFlows = cleanFlows;

    const totalWarnings =
      cleanFlows.reduce((acc, f) => acc + f.issues.filter((i) => i.severity === 'warn').length, 0) + runIssues.length;
    logger.log('Maestro flows validated and persisted', {
      flows: cleanFlows.length,
      droppedFlowCount: droppedFlows.length,
      outputDir,
      warnings: totalWarnings,
    });

    const status = droppedFlows.length > 0 ? 'warning' : 'success';
    return {
      moduleName: 'TestWriter',
      status,
      data: {
        outputDir,
        flowCount: cleanFlows.length,
        droppedFlows,
        warnings: cleanFlows.flatMap((f) => f.issues).concat(runIssues),
      },
    };
  } catch (error) {
    logger.error('Maestro flow validation/write failed', error);
    return { moduleName: 'TestWriter', status: 'error', error: String(error) };
  }
}
