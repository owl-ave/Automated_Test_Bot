import { Screen, Flow, ApiEndpoint } from '../../types';
import { ClaudeClient } from '../../ai/claude-client';
import { Logger } from '../../utils/logger';

const logger = new Logger('FlowMapper');

interface AiFlow {
  name: string;
  screens: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
}

export class FlowMapper {
  private claudeClient = new ClaudeClient();

  async mapFlows(screens: Screen[], endpoints: ApiEndpoint[]): Promise<Flow[]> {
    if (screens.length === 0) return [];

    try {
      const flows = await this.detectFlowsWithAi(screens);
      logger.log('AI flow detection complete', { count: flows.length });
      return flows;
    } catch (error) {
      logger.warn('AI flow detection failed, using name-pattern fallback', error);
      return this.patternFallback(screens);
    }
  }

  private async detectFlowsWithAi(screens: Screen[]): Promise<Flow[]> {
    const screenList = screens.map((s) => {
      const elements = s.elements.slice(0, 10).map((e) => `"${e.id}"${e.text ? ` (${e.text})` : ''}`).join(', ');
      return `- ${s.name} [${s.type}]${elements ? `\n  elements: ${elements}` : ''}`;
    }).join('\n');

    const prompt = `You are a mobile app analyst. Analyze these screens from a mobile app and group them into logical user flows.

Screens found in the codebase:
${screenList}

Group these screens into flows a QA engineer would test. Each flow should represent a complete user journey.

Rules:
- Look at screen NAMES and ELEMENT IDs to understand what each screen does — don't rely on keywords alone
- A screen named "LanguageSelectionViewController" with elements like "english_button", "spanish_button" is clearly a language/onboarding flow
- A screen with elements like "email_input", "password_input", "login_button" is authentication
- Every screen must belong to at least one flow — don't leave any screen out
- Screens that don't match obvious patterns should be grouped by their likely purpose (infer from name + elements)
- Order screens within a flow logically (e.g., language selection → onboarding → login → home)

Priority rules:
- "critical": login, signup, payment, checkout, core auth
- "high": onboarding, home, main navigation, language/locale setup, core features
- "medium": profile, settings, search, secondary features
- "low": about, help, faq, static screens

Respond ONLY with a JSON array, no explanation:
[
  {
    "name": "flow-name",
    "screens": ["ScreenName1", "ScreenName2"],
    "priority": "critical|high|medium|low",
    "reason": "one line why these screens form a flow"
  }
]`;

    const response = await this.claudeClient.prompt(prompt);
    const parsed = this.parseAiResponse(response, screens);
    return parsed;
  }

  private parseAiResponse(response: string, allScreens: Screen[]): Flow[] {
    // Lazy require to avoid circular imports if this module is imported early.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { safeJsonParse } = require('../../ai/parse-json') as typeof import('../../ai/parse-json');
    const json = safeJsonParse<AiFlow[]>(response);

    if (!Array.isArray(json)) {
      throw new Error('AI response is not a JSON array');
    }

    const validScreenNames = new Set(allScreens.map((s) => s.name));

    const flows: Flow[] = json
      .filter((f) => f.name && Array.isArray(f.screens) && f.screens.length > 0)
      .map((f) => ({
        name: f.name,
        screens: f.screens.filter((s) => validScreenNames.has(s)),
        priority: (['critical', 'high', 'medium', 'low'].includes(f.priority) ? f.priority : 'medium') as Flow['priority'],
        affectedByPr: false,
      }))
      .filter((f) => f.screens.length > 0);

    // Ensure no screen is left out — add ungrouped screens to a catch-all flow
    const groupedScreens = new Set(flows.flatMap((f) => f.screens));
    const ungrouped = allScreens.filter((s) => !groupedScreens.has(s.name)).map((s) => s.name);
    if (ungrouped.length > 0) {
      flows.push({ name: 'other-screens', screens: ungrouped, priority: 'low', affectedByPr: false });
    }

    return flows;
  }

  // Fallback used only if Claude API fails
  private patternFallback(screens: Screen[]): Flow[] {
    const patterns: { name: string; keywords: string[]; priority: Flow['priority'] }[] = [
      { name: 'authentication', keywords: ['login', 'signin', 'signup', 'register', 'auth', 'otp', 'password', 'forgot'], priority: 'critical' },
      { name: 'onboarding', keywords: ['onboard', 'welcome', 'intro', 'tutorial', 'splash', 'language', 'locale', 'setup', 'start'], priority: 'high' },
      { name: 'payment', keywords: ['cart', 'checkout', 'payment', 'billing', 'order', 'purchase'], priority: 'critical' },
      { name: 'home', keywords: ['home', 'dashboard', 'feed', 'main', 'landing'], priority: 'high' },
      { name: 'profile', keywords: ['profile', 'settings', 'account', 'preference', 'edit'], priority: 'medium' },
    ];

    const flows: Flow[] = [];
    const matched = new Set<string>();

    for (const p of patterns) {
      const hit = screens.filter((s) => p.keywords.some((k) => s.name.toLowerCase().includes(k)));
      if (hit.length > 0) {
        flows.push({ name: p.name, screens: hit.map((s) => s.name), priority: p.priority, affectedByPr: false });
        hit.forEach((s) => matched.add(s.name));
      }
    }

    const leftover = screens.filter((s) => !matched.has(s.name)).map((s) => s.name);
    if (leftover.length > 0) {
      flows.push({ name: 'app-screens', screens: leftover, priority: 'medium', affectedByPr: false });
    }

    return flows;
  }

  identifyAffectedFlows(flows: Flow[], changedScreenNames: string[]): Flow[] {
    flows.forEach((flow) => {
      flow.affectedByPr = flow.screens.some((s) =>
        changedScreenNames.some((cs) => s.toLowerCase().includes(cs.toLowerCase())),
      );
    });

    const affected = flows.filter((f) => f.affectedByPr);
    if (affected.length > 0) return affected;

    // No flows matched changed files — return critical/high as fallback
    logger.warn('No flows matched changed screens, falling back to high-priority flows');
    const fallback = flows.filter((f) => f.priority === 'critical' || f.priority === 'high');
    return fallback.length > 0 ? fallback : flows;
  }
}
