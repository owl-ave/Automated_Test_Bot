import { PipelineContext, ModuleResult, MaestroFlow } from '../../types';
import { MaestroAuthor } from './feature-generator';
import { resolveAppId } from '../test-writer/maestro-flow-generator';
import { Logger } from '../../utils/logger';

const LOGIN_KEYWORDS = ['log in', 'login', 'sign in', 'sign up', 'register', 'authenticate', 'otp', 'biometric'];

function isLoginScenario(flow: MaestroFlow): boolean {
  const text = (flow.feature + ' ' + flow.scenario + ' ' + flow.yaml).toLowerCase();
  return LOGIN_KEYWORDS.some((kw) => text.includes(kw));
}

function filterAuthScenarios(flows: MaestroFlow[], authType: string | undefined): MaestroFlow[] {
  if (!authType || authType === 'none') return flows.filter((f) => !isLoginScenario(f));
  return flows;
}

export async function runScenarioBrain(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('ScenarioBrain');

  if (!context.codeAnalysis || !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { moduleName: 'ScenarioBrain', status: 'error', error: 'Missing analysis or auth token' };
  }

  try {
    // The bot needs at least one platform's appId to emit a runnable flow. We
    // pick whichever platform AppBuilder produced — if both, prefer Android
    // since RN/Flutter testIDs map to identical accessibility ids on iOS too.
    const appIds = resolveAppId(context.codeAnalysis.framework, context.mobilePath);
    const appId = appIds.android ?? appIds.ios;
    if (!appId) {
      return {
        moduleName: 'ScenarioBrain',
        status: 'error',
        error:
          'Could not resolve appId (Android applicationId or iOS CFBundleIdentifier) from source. ' +
          'Set MAESTRO_ANDROID_APP_ID and/or MAESTRO_IOS_APP_ID env vars to override.',
      };
    }

    const author = new MaestroAuthor();
    const inputs = {
      industry: context.codeAnalysis.industry,
      framework: context.codeAnalysis.framework,
      screens: context.codeAnalysis.screens,
      appId,
    };

    let flows: MaestroFlow[];
    if (context.codeAnalysis.criticalFlows.length > 0) {
      flows = await author.generateFromFlows(context.codeAnalysis.criticalFlows, inputs);
      logger.log('Maestro flows generated (from critical flows)', { flows: flows.length });
    } else {
      const diffSummary = context.diffFiles
        .slice(0, 15)
        .map((f) => `${f.status} ${f.path}\n${f.patch?.slice(0, 500) || ''}`)
        .join('\n---\n');
      flows = await author.generateFromDiff(diffSummary, inputs);
      logger.log('Maestro flows generated (from PR diff)', { flows: flows.length });
    }

    const filtered = filterAuthScenarios(flows, context.authConfig?.type);
    if (filtered.length < flows.length) {
      logger.log('Auth scenarios filtered (no usable auth config)', {
        before: flows.length,
        after: filtered.length,
        dropped: flows.length - filtered.length,
        authConfigType: context.authConfig?.type ?? 'none',
      });
    }
    context.maestroFlows = filtered;
    return { moduleName: 'ScenarioBrain', status: 'success', data: context.maestroFlows };
  } catch (error) {
    logger.error('Maestro flow generation failed', error);
    return { moduleName: 'ScenarioBrain', status: 'error', error: String(error) };
  }
}
