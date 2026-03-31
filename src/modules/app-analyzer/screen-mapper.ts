import { CodeAnalysis, Screen } from '../../types';
import { Logger } from '../../utils/logger';

export interface ScreenNode {
  screen: Screen;
  navigatesTo: string[];
  navigatedFrom: string[];
  isEntryPoint: boolean;
  isModal: boolean;
  isTabBarItem: boolean;
  deepLinkPattern?: string;
  depth: number;
}

export interface ScreenMap {
  nodes: ScreenNode[];
  entryPoints: string[];
  tabBarScreens: string[];
  modals: string[];
  deepLinks: { pattern: string; screen: string }[];
  coreFlows: { name: string; screens: string[] }[];
}

export class ScreenMapper {
  private logger = new Logger('ScreenMapper');

  mapScreens(codeAnalysis: CodeAnalysis): ScreenMap {
    const { screens, framework } = codeAnalysis;

    if (screens.length === 0) {
      this.logger.warn('No screens found in code analysis');
      return this.emptyMap();
    }

    const nodes = this.buildScreenNodes(screens, framework);
    this.detectEntryPoints(nodes, framework);
    this.detectTabBarItems(nodes, framework);
    this.detectModals(nodes);
    const deepLinks = this.extractDeepLinks(nodes);
    const coreFlows = this.extractCoreFlows(nodes);

    const map: ScreenMap = {
      nodes,
      entryPoints: nodes.filter((n) => n.isEntryPoint).map((n) => n.screen.name),
      tabBarScreens: nodes.filter((n) => n.isTabBarItem).map((n) => n.screen.name),
      modals: nodes.filter((n) => n.isModal).map((n) => n.screen.name),
      deepLinks,
      coreFlows,
    };

    this.logger.log('Screen mapping complete', {
      totalScreens: nodes.length,
      entryPoints: map.entryPoints.length,
      tabBarScreens: map.tabBarScreens.length,
      modals: map.modals.length,
      deepLinks: deepLinks.length,
      coreFlows: coreFlows.length,
    });

    return map;
  }

  private buildScreenNodes(screens: Screen[], framework: string): ScreenNode[] {
    const nodes: ScreenNode[] = screens.map((screen) => ({
      screen,
      navigatesTo: [],
      navigatedFrom: [],
      isEntryPoint: false,
      isModal: false,
      isTabBarItem: false,
      depth: -1,
    }));

    const screenNames = new Set(screens.map((s) => s.name.toLowerCase()));

    for (const node of nodes) {
      const navigationTargets = this.extractNavigationTargets(node.screen, framework);
      for (const target of navigationTargets) {
        const normalizedTarget = target.toLowerCase();
        if (screenNames.has(normalizedTarget)) {
          const targetNode = nodes.find((n) => n.screen.name.toLowerCase() === normalizedTarget);
          if (targetNode) {
            node.navigatesTo.push(targetNode.screen.name);
            targetNode.navigatedFrom.push(node.screen.name);
          }
        }
      }
    }

    return nodes;
  }

  private extractNavigationTargets(screen: Screen, framework: string): string[] {
    const targets: string[] = [];
    const name = screen.name.toLowerCase();
    const elementsText = screen.elements
      .map((e) => `${e.id} ${e.text || ''} ${e.type}`)
      .join(' ')
      .toLowerCase();

    // Infer navigation from element names/types
    const navPatterns = [/navigate\s*\(\s*['"](\w+)['"]/gi, /push\s*\(\s*['"](\w+)['"]/gi, /goto\s*['"](\w+)['"]/gi];

    for (const pattern of navPatterns) {
      let match;
      while ((match = pattern.exec(elementsText)) !== null) {
        targets.push(match[1]);
      }
    }

    // Infer from button elements that suggest navigation
    for (const element of screen.elements) {
      const text = (element.text || element.id || '').toLowerCase();
      if (text.includes('go to') || text.includes('open') || text.includes('view')) {
        const screenRef = text
          .replace(/go\s*to|open|view/gi, '')
          .trim()
          .replace(/\s+/g, '');
        if (screenRef) targets.push(screenRef);
      }
    }

    return [...new Set(targets)];
  }

  private detectEntryPoints(nodes: ScreenNode[], framework: string): void {
    const entryPatterns = [/^(home|main|splash|launch|landing|root|app|index|welcome|onboarding)/i];

    // Screens with no incoming navigation are likely entry points
    const noIncoming = nodes.filter((n) => n.navigatedFrom.length === 0);

    for (const node of nodes) {
      const name = node.screen.name;
      const isPatternMatch = entryPatterns.some((p) => p.test(name));
      const isOrphan = noIncoming.includes(node) && nodes.length > 1;

      if (isPatternMatch) {
        node.isEntryPoint = true;
        node.depth = 0;
      } else if (isOrphan && !this.isLikelyModal(name)) {
        node.isEntryPoint = true;
        node.depth = 0;
      }
    }

    // If no entry point found, use first screen
    if (!nodes.some((n) => n.isEntryPoint) && nodes.length > 0) {
      nodes[0].isEntryPoint = true;
      nodes[0].depth = 0;
    }

    // BFS to assign depth
    const queue = nodes.filter((n) => n.depth === 0);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const targetName of current.navigatesTo) {
        const target = nodes.find((n) => n.screen.name === targetName);
        if (target && target.depth === -1) {
          target.depth = current.depth + 1;
          queue.push(target);
        }
      }
    }

    // Assign remaining unvisited nodes a high depth
    for (const node of nodes) {
      if (node.depth === -1) node.depth = 99;
    }
  }

  private detectTabBarItems(nodes: ScreenNode[], framework: string): void {
    const tabPatterns = [
      /^(home|search|explore|discover|profile|account|settings|cart|favorites|messages|notifications|feed|activity|more|menu)/i,
    ];

    // Tab bar items are typically at depth 0-1 and match common tab names
    for (const node of nodes) {
      if (node.depth <= 1 && tabPatterns.some((p) => p.test(node.screen.name))) {
        node.isTabBarItem = true;
      }
    }
  }

  private detectModals(nodes: ScreenNode[]): void {
    for (const node of nodes) {
      if (this.isLikelyModal(node.screen.name)) {
        node.isModal = true;
      }
    }
  }

  private isLikelyModal(name: string): boolean {
    const modalPatterns =
      /modal|popup|dialog|alert|sheet|overlay|picker|dropdown|toast|bottom.?sheet|action.?sheet|prompt/i;
    return modalPatterns.test(name);
  }

  private extractDeepLinks(nodes: ScreenNode[]): { pattern: string; screen: string }[] {
    const deepLinks: { pattern: string; screen: string }[] = [];

    for (const node of nodes) {
      const name = node.screen.name.toLowerCase();
      // Common deep-linkable screens
      const deepLinkablePatterns: { pattern: RegExp; template: string }[] = [
        { pattern: /product.?detail/i, template: '/product/:id' },
        { pattern: /order.?detail/i, template: '/order/:id' },
        { pattern: /profile/i, template: '/profile/:userId' },
        { pattern: /settings/i, template: '/settings' },
        { pattern: /checkout/i, template: '/checkout' },
        { pattern: /chat/i, template: '/chat/:conversationId' },
        { pattern: /notification/i, template: '/notifications' },
      ];

      for (const { pattern, template } of deepLinkablePatterns) {
        if (pattern.test(name)) {
          deepLinks.push({ pattern: template, screen: node.screen.name });
          node.deepLinkPattern = template;
          break;
        }
      }
    }

    return deepLinks;
  }

  private extractCoreFlows(nodes: ScreenNode[]): { name: string; screens: string[] }[] {
    const flows: { name: string; screens: string[] }[] = [];

    // Identify flows by tracing paths from entry points
    const entryPoints = nodes.filter((n) => n.isEntryPoint);

    for (const entry of entryPoints) {
      const visited = new Set<string>();
      const flowScreens: string[] = [];

      const dfs = (node: ScreenNode, depth: number) => {
        if (visited.has(node.screen.name) || depth > 8) return;
        visited.add(node.screen.name);
        flowScreens.push(node.screen.name);

        for (const targetName of node.navigatesTo) {
          const target = nodes.find((n) => n.screen.name === targetName);
          if (target) dfs(target, depth + 1);
        }
      };

      dfs(entry, 0);

      if (flowScreens.length > 1) {
        flows.push({ name: `${entry.screen.name} flow`, screens: flowScreens });
      }
    }

    // Detect common flow patterns by screen name grouping
    const flowGroups: Record<string, string[]> = {};
    for (const node of nodes) {
      const name = node.screen.name.toLowerCase();
      const groupPatterns: { group: string; pattern: RegExp }[] = [
        { group: 'Authentication', pattern: /login|signin|signup|register|forgot|reset|otp|verify/i },
        { group: 'Checkout', pattern: /cart|checkout|payment|shipping|address|order.?confirm/i },
        { group: 'Onboarding', pattern: /onboard|welcome|intro|tutorial|walkthrough/i },
        { group: 'Profile', pattern: /profile|account|settings|edit.?profile|preferences/i },
        { group: 'Search', pattern: /search|filter|sort|results|browse/i },
      ];

      for (const { group, pattern } of groupPatterns) {
        if (pattern.test(name)) {
          if (!flowGroups[group]) flowGroups[group] = [];
          flowGroups[group].push(node.screen.name);
        }
      }
    }

    for (const [name, screens] of Object.entries(flowGroups)) {
      if (screens.length >= 2) {
        flows.push({ name, screens });
      }
    }

    return flows;
  }

  private emptyMap(): ScreenMap {
    return {
      nodes: [],
      entryPoints: [],
      tabBarScreens: [],
      modals: [],
      deepLinks: [],
      coreFlows: [],
    };
  }
}
