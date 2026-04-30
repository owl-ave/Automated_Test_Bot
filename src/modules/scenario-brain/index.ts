import { PipelineContext, ModuleResult, MaestroFlow, Flow, LaunchState, AuthConfig } from '../../types';
import { MaestroAuthor } from './feature-generator';
import { resolveAppId } from '../test-writer/maestro-flow-generator';
import { getThresholds } from '../../config/thresholds';
import { Logger } from '../../utils/logger';

const PRIORITY_RANK: Record<Flow['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// Caps the flow list at `max` after sorting by priority (critical first).
// PR-affected flows always rank ahead of unaffected ones at the same priority
// — since FlowMapper.identifyAffectedFlows already returns affected-only when
// any match the diff, this is mostly defensive for the "no diff match → fall
// back to high-priority" branch where some unaffected flows slip through.
export function capFlowsByPriority(flows: Flow[], max: number): Flow[] {
  if (flows.length <= max) return flows;
  const sorted = [...flows].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 99;
    const pb = PRIORITY_RANK[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    if (a.affectedByPr !== b.affectedByPr) return a.affectedByPr ? -1 : 1;
    return 0;
  });
  return sorted.slice(0, max);
}

// Stem-based patterns so "logs in" / "logged in" / "signing up" match too.
const LOGIN_PATTERNS: RegExp[] = [
  /\blog(?:s|ged|ging)?[ -]?in\b/,
  /\bsign(?:s|ed|ing)?[ -]?(?:in|up)\b/,
  /\blogin\b/,
  /\bsignup\b/,
  /\bregister(?:s|ed|ing)?\b/,
  /\bauthenticat(?:e|es|ed|ing|ion)\b/,
  /\botp\b/,
  /\bbiometric\b/,
];
// Scenarios that touch login screens but verify UI/validation/error behaviour
// (rather than performing an actual auth handshake) are safe without creds —
// e.g. "Login button shows error on empty submit", "Sign-in screen renders".
const NEGATIVE_AUTH_KEYWORDS = [
  'invalid', 'incorrect', 'wrong', 'empty', 'missing', 'no input',
  'error', 'validation', 'visible', 'displayed', 'render', 'shows', 'shown',
];

// True if a scenario *attempts to authenticate* (and therefore needs real creds).
// Title-only check — yaml-level matches were too greedy and dropped UI tests
// that merely tap an "OK" button on a login screen.
export function isLoginAttempt(flow: MaestroFlow): boolean {
  const titleText = (flow.feature + ' ' + flow.scenario).toLowerCase();
  if (!LOGIN_PATTERNS.some((re) => re.test(titleText))) return false;
  if (NEGATIVE_AUTH_KEYWORDS.some((kw) => titleText.includes(kw))) return false;
  return true;
}

export function filterAuthScenarios(flows: MaestroFlow[], authType: string | undefined): MaestroFlow[] {
  if (!authType || authType === 'none') return flows.filter((f) => !isLoginAttempt(f));
  return flows;
}

// True iff at least one usable identifier (email/phone/username) is configured.
// Guest/none auth types don't carry creds even if their fields are set.
export function hasUsableCreds(auth?: AuthConfig): boolean {
  if (!auth || auth.type === 'none' || auth.type === 'guest') return false;
  return Boolean(auth.email || auth.phone || auth.username);
}

// When the app requires auth and no creds are configured, post-auth flows
// can never pass — drop them before the AI call. The pre-auth surface a flow
// may touch is: declared authScreens ∪ cold-launch preAuthGates ∪ initialScreen.
// Pre-auth gates (language pickers, terms acceptance, paywalls) are walked on
// every cold launch before login is even reachable, so flows that cover them
// must survive. Without this expansion, only pure login flows survived and the
// downstream auth filter then dropped them all → guaranteed zero-flow crash.
export function filterFlowsByLaunchState(flows: Flow[], launchState?: LaunchState, credsAvailable?: boolean): Flow[] {
  if (!launchState || !launchState.requiresAuth || credsAvailable) return flows;
  if (launchState.authScreens.length === 0) return flows;
  const preAuthSurface = new Set<string>([
    ...launchState.authScreens,
    ...(launchState.preAuthGates?.map((g) => g.screen) ?? []),
    launchState.initialScreen,
  ]);
  return flows.filter((flow) => flow.screens.length > 0 && flow.screens.every((s) => preAuthSurface.has(s)));
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
    const launchState = context.codeAnalysis.launchState;
    const credsAvailable = hasUsableCreds(context.authConfig);
    const inputs = {
      industry: context.codeAnalysis.industry,
      framework: context.codeAnalysis.framework,
      screens: context.codeAnalysis.screens,
      appId,
      launchState,
      authConfig: context.authConfig,
    };

    if (launchState?.requiresAuth) {
      logger.log('Launch-state aware generation', {
        initialScreen: launchState.initialScreen,
        authScreens: launchState.authScreens,
        postAuthEntry: launchState.postAuthEntry,
        credsAvailable,
        source: launchState.source,
      });
    }

    if (launchState?.preAuthGates && launchState.preAuthGates.length > 0) {
      logger.log('Cold-launch preamble', {
        gates: launchState.preAuthGates.map((g) => ({
          screen: g.screen,
          dismiss: g.dismiss.type,
        })),
      });
    }

    let flows: MaestroFlow[];
    const launchStateFiltered = filterFlowsByLaunchState(
      context.codeAnalysis.criticalFlows,
      launchState,
      credsAvailable,
    );
    if (launchStateFiltered.length < context.codeAnalysis.criticalFlows.length) {
      logger.log('Dropped post-auth flows (no creds configured)', {
        before: context.codeAnalysis.criticalFlows.length,
        after: launchStateFiltered.length,
        dropped: context.codeAnalysis.criticalFlows.length - launchStateFiltered.length,
      });
    }

    // BrowserStack bills device-minutes — even 1-minute flows add up. Cap the
    // list before the AI call to bound per-PR cost and total run time.
    const maxFlows = getThresholds().maxFlowsPerPr;
    const eligibleFlows = capFlowsByPriority(launchStateFiltered, maxFlows);
    if (eligibleFlows.length < launchStateFiltered.length) {
      logger.log('Capped flows for cost control', {
        before: launchStateFiltered.length,
        after: eligibleFlows.length,
        cap: maxFlows,
        kept: eligibleFlows.map((f) => `${f.priority}:${f.name}`),
      });
    }

    if (eligibleFlows.length > 0) {
      flows = await author.generateFromFlows(eligibleFlows, inputs);
      logger.log('Maestro flows generated (from critical flows)', { flows: flows.length });
    } else {
      const diffSummary = context.diffFiles
        .slice(0, 15)
        .map((f) => `${f.status} ${f.path}\n${f.patch?.slice(0, 500) || ''}`)
        .join('\n---\n');
      flows = await author.generateFromDiff(diffSummary, inputs);
      logger.log('Maestro flows generated (from PR diff)', { flows: flows.length });
    }

    let filtered = filterAuthScenarios(flows, context.authConfig?.type);
    if (filtered.length < flows.length) {
      logger.log('Auth scenarios filtered (no usable auth config)', {
        before: flows.length,
        after: filtered.length,
        dropped: flows.length - filtered.length,
        authConfigType: context.authConfig?.type ?? 'none',
      });
    }

    // If both filters together left zero flows AND we haven't already gone the diff route,
    // fall back to PR-diff generation. Without this, TestWriter aborts the whole pipeline
    // (e.g. an auth-required app with no creds where every critical flow ended up being
    // a real-login attempt).
    if (filtered.length === 0 && eligibleFlows.length > 0 && context.diffFiles.length > 0) {
      logger.log('All flows filtered out — falling back to PR-diff generation');
      const diffSummary = context.diffFiles
        .slice(0, 15)
        .map((f) => `${f.status} ${f.path}\n${f.patch?.slice(0, 500) || ''}`)
        .join('\n---\n');
      const diffFlows = await author.generateFromDiff(diffSummary, inputs);
      filtered = filterAuthScenarios(diffFlows, context.authConfig?.type);
      logger.log('Diff-based fallback flows generated', { flows: filtered.length });
    }

    context.maestroFlows = filtered;
    return { moduleName: 'ScenarioBrain', status: 'success', data: context.maestroFlows };
  } catch (error) {
    logger.error('Maestro flow generation failed', error);
    return { moduleName: 'ScenarioBrain', status: 'error', error: String(error) };
  }
}
