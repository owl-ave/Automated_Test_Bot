import { Screen, Flow, ApiEndpoint } from '../../types';
import { Logger } from '../../utils/logger';

export class FlowMapper {
  private logger = new Logger('FlowMapper');

  mapFlows(screens: Screen[], endpoints: ApiEndpoint[]): Flow[] {
    const flows: Flow[] = [];

    // Common flow patterns
    const patterns: { [key: string]: { screens: string[]; priority: string } } = {
      authentication: { screens: ['login', 'signup', 'otp', 'password'], priority: 'critical' },
      payment: { screens: ['cart', 'checkout', 'payment', 'confirmation'], priority: 'critical' },
      home: { screens: ['home', 'dashboard', 'feed'], priority: 'high' },
      search: { screens: ['search', 'results', 'detail'], priority: 'high' },
      profile: { screens: ['profile', 'settings', 'account'], priority: 'medium' },
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
