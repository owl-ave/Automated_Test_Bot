import { Screen, Flow, ApiEndpoint } from '../../types';
import { Logger } from '../../utils/logger';

export class FlowMapper {
  private logger = new Logger('FlowMapper');

  mapFlows(screens: Screen[], endpoints: ApiEndpoint[]): Flow[] {
    const flows: Flow[] = [];

    // Common flow patterns — covers all platforms (RN screens, Activities, ViewControllers, Composables, SwiftUI Views)
    const patterns: { [key: string]: { screens: string[]; priority: string } } = {
      authentication: { screens: ['login', 'signup', 'otp', 'password', 'auth', 'register', 'signin', 'signout'], priority: 'critical' },
      onboarding: { screens: ['onboard', 'welcome', 'intro', 'tutorial', 'walkthrough', 'splash'], priority: 'high' },
      payment: { screens: ['cart', 'checkout', 'payment', 'confirmation', 'billing', 'order', 'purchase'], priority: 'critical' },
      home: { screens: ['home', 'dashboard', 'feed', 'main', 'root', 'landing'], priority: 'high' },
      search: { screens: ['search', 'results', 'detail', 'filter', 'discover', 'explore'], priority: 'high' },
      profile: { screens: ['profile', 'settings', 'account', 'preference', 'edit'], priority: 'medium' },
      navigation: { screens: ['tab', 'menu', 'drawer', 'navigation', 'sidebar', 'bottombar'], priority: 'high' },
      media: { screens: ['camera', 'photo', 'video', 'gallery', 'image', 'media', 'upload'], priority: 'medium' },
      messaging: { screens: ['chat', 'message', 'conversation', 'inbox', 'notification'], priority: 'high' },
    };

    for (const [flowName, config] of Object.entries(patterns)) {
      const matchedScreens = screens.filter((s) => config.screens.some((p) => s.name.toLowerCase().includes(p)));
      if (matchedScreens.length > 0) {
        flows.push({
          name: flowName,
          screens: matchedScreens.map((s) => s.name),
          priority: config.priority as 'critical' | 'high' | 'medium' | 'low',
          affectedByPr: false,
        });
      }
    }

    // Native navigation detection — group Activities/ViewControllers/Fragments by type into navigation flows
    const activities = screens.filter((s) => s.type === 'activity');
    const fragments = screens.filter((s) => s.type === 'fragment');
    const viewControllers = screens.filter((s) => s.type === 'viewcontroller');
    const composables = screens.filter((s) => s.type === 'composable');
    const swiftuiViews = screens.filter((s) => s.type === 'swiftui-view');

    // If we found native screens not already captured by pattern matching, add a catch-all navigation flow
    const unmatchedScreens = screens.filter((s) => !flows.some((f) => f.screens.includes(s.name)));
    if (unmatchedScreens.length > 0) {
      // Group by screen type for coherent flows
      if (activities.length + fragments.length > 0) {
        const androidScreens = [...activities, ...fragments, ...composables]
          .filter((s) => unmatchedScreens.includes(s))
          .map((s) => s.name);
        if (androidScreens.length > 0) {
          flows.push({ name: 'android-navigation', screens: androidScreens, priority: 'medium', affectedByPr: false });
        }
      }
      if (viewControllers.length + swiftuiViews.length > 0) {
        const iosScreens = [...viewControllers, ...swiftuiViews]
          .filter((s) => unmatchedScreens.includes(s))
          .map((s) => s.name);
        if (iosScreens.length > 0) {
          flows.push({ name: 'ios-navigation', screens: iosScreens, priority: 'medium', affectedByPr: false });
        }
      }
    }

    // API-driven flows — if endpoints match common patterns, create flows for them
    const apiPatterns: { [key: string]: { endpoints: string[]; priority: string } } = {
      'api-auth': { endpoints: ['/login', '/signup', '/auth', '/token', '/register'], priority: 'critical' },
      'api-data': { endpoints: ['/users', '/profile', '/account'], priority: 'high' },
      'api-payment': { endpoints: ['/payment', '/charge', '/order', '/checkout'], priority: 'critical' },
    };

    for (const [flowName, config] of Object.entries(apiPatterns)) {
      const matchedEndpoints = endpoints.filter((e) => config.endpoints.some((p) => e.path.toLowerCase().includes(p)));
      if (matchedEndpoints.length > 0 && !flows.some((f) => f.name === flowName)) {
        flows.push({
          name: flowName,
          screens: matchedEndpoints.map((e) => `${e.method} ${e.path}`),
          priority: config.priority as 'critical' | 'high' | 'medium' | 'low',
          affectedByPr: false,
        });
      }
    }

    this.logger.log('Flows mapped', { count: flows.length });
    return flows;
  }

  identifyAffectedFlows(flows: Flow[], changedScreenNames: string[]): Flow[] {
    flows.forEach((flow) => {
      flow.affectedByPr = flow.screens.some((s) =>
        changedScreenNames.some((cs) => s.toLowerCase().includes(cs.toLowerCase())),
      );
    });
    return flows.filter((f) => f.affectedByPr);
  }
}
