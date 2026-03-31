import { Logger } from '../../utils/logger';

const logger = new Logger('FlowAdapter');

export type AdaptAction = 'dismiss' | 'accept' | 'skip' | 'back' | 'report';

export interface AdaptResult {
  action: AdaptAction;
  description: string;
  elementToInteract?: { strategy: string; value: string };
  confidence: number;
}

interface PopupPattern {
  indicators: string[];
  action: AdaptAction;
  interactWith?: { strategy: string; valuePattern: string };
  description: string;
}

const KNOWN_POPUP_PATTERNS: PopupPattern[] = [
  // Android permission dialogs
  {
    indicators: ['com.android.permissioncontroller', 'permission_message', 'Grant', 'ALLOW', 'While using'],
    action: 'accept',
    interactWith: { strategy: 'id', valuePattern: 'com.android.permissioncontroller:id/permission_allow_button' },
    description: 'Android runtime permission dialog',
  },
  {
    indicators: ['com.android.permissioncontroller', 'DENY', "Don't allow"],
    action: 'accept', // still accept — we want to grant permissions for testing
    interactWith: {
      strategy: 'xpath',
      valuePattern: '//*[contains(@text,"Allow") or contains(@text,"ALLOW") or contains(@text,"While using")]',
    },
    description: 'Android permission dialog (alternative)',
  },
  // iOS permission dialogs
  {
    indicators: ['XCUIElementTypeAlert', 'Allow', "Don't Allow", 'would like to'],
    action: 'accept',
    interactWith: {
      strategy: 'xpath',
      valuePattern: '//XCUIElementTypeButton[@name="Allow" or @name="OK" or @name="Allow While Using App"]',
    },
    description: 'iOS permission alert',
  },
  // Cookie/consent banners
  {
    indicators: ['cookie', 'consent', 'Accept All', 'Accept Cookies', 'I Agree'],
    action: 'accept',
    interactWith: {
      strategy: 'xpath',
      valuePattern: '//*[contains(@text,"Accept") or contains(@text,"I Agree") or contains(@text,"Got it")]',
    },
    description: 'Cookie/consent banner',
  },
  // App update dialogs
  {
    indicators: ['update', 'new version', 'Update Now', 'Later', 'Remind Me'],
    action: 'dismiss',
    interactWith: {
      strategy: 'xpath',
      valuePattern:
        '//*[contains(@text,"Later") or contains(@text,"Skip") or contains(@text,"Not Now") or contains(@text,"Remind")]',
    },
    description: 'App update dialog',
  },
  // Rating/review prompts
  {
    indicators: ['rate', 'review', 'Rate this app', 'Enjoying', 'stars'],
    action: 'dismiss',
    interactWith: {
      strategy: 'xpath',
      valuePattern:
        '//*[contains(@text,"Not Now") or contains(@text,"Later") or contains(@text,"No Thanks") or contains(@text,"Cancel")]',
    },
    description: 'App rating prompt',
  },
  // Onboarding/tutorial screens
  {
    indicators: ['Skip', 'Get Started', 'Next', 'tutorial', 'onboarding', 'walkthrough'],
    action: 'skip',
    interactWith: {
      strategy: 'xpath',
      valuePattern: '//*[contains(@text,"Skip") or contains(@text,"Get Started") or contains(@text,"Done")]',
    },
    description: 'Onboarding/tutorial overlay',
  },
  // Login/signup walls
  {
    indicators: ['Sign In', 'Log In', 'Create Account', 'Sign Up', 'Continue as Guest'],
    action: 'skip',
    interactWith: {
      strategy: 'xpath',
      valuePattern:
        '//*[contains(@text,"Skip") or contains(@text,"Guest") or contains(@text,"Later") or contains(@text,"Maybe Later")]',
    },
    description: 'Login/signup wall',
  },
  // Push notification prompts
  {
    indicators: ['notifications', 'push', 'Enable Notifications', 'Stay Updated'],
    action: 'dismiss',
    interactWith: {
      strategy: 'xpath',
      valuePattern:
        '//*[contains(@text,"Not Now") or contains(@text,"Skip") or contains(@text,"No Thanks") or contains(@text,"Later")]',
    },
    description: 'Push notification prompt',
  },
  // Error/crash dialogs
  {
    indicators: ['has stopped', 'keeps stopping', "isn't responding", 'crash', 'Unfortunately'],
    action: 'report',
    description: 'App crash dialog',
  },
  // Ads / interstitials
  {
    indicators: ['Ad', 'Close', 'Skip Ad', 'advertisement'],
    action: 'dismiss',
    interactWith: {
      strategy: 'xpath',
      valuePattern: '//*[contains(@text,"Close") or contains(@text,"Skip") or contains(@content-desc,"Close")]',
    },
    description: 'Advertisement/interstitial',
  },
];

export class FlowAdapter {
  handleUnexpectedScreen(currentScreen: string, expectedScreen: string, pageSource: string): AdaptResult {
    logger.log('Handling unexpected screen', {
      expected: expectedScreen.substring(0, 50),
      current: currentScreen.substring(0, 50),
    });

    const sourceLower = pageSource.toLowerCase();

    // Check each pattern against the page source
    for (const pattern of KNOWN_POPUP_PATTERNS) {
      const matchCount = pattern.indicators.filter((indicator) => sourceLower.includes(indicator.toLowerCase())).length;

      const matchRatio = matchCount / pattern.indicators.length;

      if (matchRatio >= 0.3 && matchCount >= 2) {
        const result: AdaptResult = {
          action: pattern.action,
          description: pattern.description,
          confidence: Math.round(matchRatio * 100),
        };

        if (pattern.interactWith) {
          result.elementToInteract = {
            strategy: pattern.interactWith.strategy,
            value: pattern.interactWith.valuePattern,
          };
        }

        logger.log('Matched popup pattern', { description: pattern.description, confidence: result.confidence });
        return result;
      }
    }

    // No known pattern matched — check for generic dismissal options
    const dismissButtons = [
      { text: 'OK', xpath: '//*[@text="OK" or @text="Ok" or @name="OK"]' },
      { text: 'Close', xpath: '//*[@text="Close" or @content-desc="Close" or @name="Close"]' },
      { text: 'Cancel', xpath: '//*[@text="Cancel" or @name="Cancel"]' },
      { text: 'Dismiss', xpath: '//*[@text="Dismiss" or @name="Dismiss"]' },
    ];

    for (const btn of dismissButtons) {
      if (sourceLower.includes(btn.text.toLowerCase())) {
        return {
          action: 'dismiss',
          description: `Found generic "${btn.text}" button on unexpected screen`,
          elementToInteract: { strategy: 'xpath', value: btn.xpath },
          confidence: 40,
        };
      }
    }

    // Try back button as last resort
    return {
      action: 'back',
      description: 'No recognized popup pattern. Will attempt back navigation.',
      confidence: 20,
    };
  }

  async executeAdaptation(driver: any, adaptResult: AdaptResult): Promise<boolean> {
    logger.log('Executing adaptation', { action: adaptResult.action, description: adaptResult.description });

    try {
      switch (adaptResult.action) {
        case 'accept':
        case 'dismiss':
        case 'skip': {
          if (adaptResult.elementToInteract) {
            const el = await driver.findElement(
              adaptResult.elementToInteract.strategy,
              adaptResult.elementToInteract.value,
            );
            if (el) {
              const elId = el.ELEMENT || el[Object.keys(el)[0]];
              await driver.clickElement(elId);
              return true;
            }
          }
          return false;
        }
        case 'back': {
          await driver.back();
          return true;
        }
        case 'report': {
          logger.warn('Unexpected screen requires reporting — likely an app crash');
          return false;
        }
        default:
          return false;
      }
    } catch (error) {
      logger.error('Adaptation execution failed', error);
      return false;
    }
  }
}
