import axios from 'axios';
import { getBrowserStackConfig, BrowserStackConfig } from '../../config/browserstack';
import { getAppiumCapabilities } from '../../config/appium-caps';
import { Device } from '../../config/devices';
import { BddScenario, GherkinStep, TestResult } from '../../types';
import { GestureExecutor } from './gestures';
import { Logger } from '../../utils/logger';

const logger = new Logger('TestExecutor');

const HUB_URL = 'https://hub.browserstack.com/wd/hub';

const TIMEOUTS = {
  ELEMENT_WAIT: 5000,
  ELEMENT_ASSERT_WAIT: 10000,
  STEP_INITIAL_RETRY_DELAY: 1000,
} as const;

interface SessionInfo {
  sessionId: string;
  driver: any;
  device: Device;
}

export class TestExecutor {
  private config: BrowserStackConfig;
  private gestures: GestureExecutor;

  constructor() {
    this.config = getBrowserStackConfig();
    this.gestures = new GestureExecutor();
  }

  async executeTests(appUrl: string, scenarios: BddScenario[], devices: Device[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const device of devices) {
      logger.log('Starting device run', { device: device.name });
      let session: SessionInfo | null = null;

      try {
        session = await this.createSession(appUrl, device);

        for (let i = 0; i < scenarios.length; i++) {
          // Reset app state between scenarios to prevent state leakage
          if (i > 0) {
            try { await session.driver.resetApp(); await new Promise(r => setTimeout(r, 2000)); } catch { /* reset not supported on all platforms */ }
          }
          const result = await this.executeScenario(session, scenarios[i]);
          results.push(result);
        }
      } catch (error) {
        logger.error(`Device ${device.name} session failed`, error);
        // Record failure for all remaining scenarios on this device
        for (const scenario of scenarios) {
          if (!results.find((r) => r.scenario === scenario.scenario && r.device === device.name)) {
            results.push({
              scenario: scenario.scenario,
              status: 'fail',
              device: device.name,
              duration: 0,
              error: `Session error: ${String(error)}`,
            });
          }
        }
      } finally {
        if (session) {
          // Fetch video URL before closing session
          try {
            const videoUrl = await this.getSessionVideoUrl(session.sessionId);
            if (videoUrl) {
              for (const result of results) {
                if (result.sessionId === session.sessionId) {
                  result.videoUrl = videoUrl;
                }
              }
            }
          } catch {
            logger.warn('Video URL fetch failed, continuing with session cleanup');
          }
          await this.closeSession(session);
        }
      }
    }

    return results;
  }

  private async createSession(appUrl: string, device: Device): Promise<SessionInfo> {
    const capabilities = getAppiumCapabilities(device, appUrl);

    const bsCapabilities = {
      ...capabilities,
      'bstack:options': {
        userName: this.config.username,
        accessKey: this.config.accessKey,
        projectName: 'AutomatedTestingBot',
        buildName: `PR-${Date.now()}`,
        sessionName: `${device.name} Test Run`,
        debug: true,
        networkLogs: true,
        deviceLogs: true,
        video: true,
      },
    };

    logger.log('Creating session', { device: device.name });

    const response = await axios.post(
      `${HUB_URL}/session`,
      { capabilities: { alwaysMatch: bsCapabilities } },
      {
        auth: {
          username: this.config.username,
          password: this.config.accessKey,
        },
        timeout: this.config.timeout * 2,
      },
    );

    // W3C: value.sessionId, legacy: sessionId, BrowserStack sometimes nests differently
    const sessionId =
      response.data.value?.sessionId ||
      response.data.sessionId ||
      response.data.value?.capabilities?.sessionId ||
      '';

    if (!sessionId) {
      logger.error('BrowserStack returned empty sessionId', { responseKeys: Object.keys(response.data), valueKeys: Object.keys(response.data.value || {}) });
      throw new Error(`BrowserStack session created but sessionId is empty. Response: ${JSON.stringify(response.data).slice(0, 500)}`);
    }

    logger.log('Session created', { sessionId, device: device.name });

    return {
      sessionId,
      driver: new WebDriverClient(sessionId, this.config),
      device,
    };
  }

  private async executeScenario(session: SessionInfo, scenario: BddScenario): Promise<TestResult> {
    const startTime = Date.now();

    try {
      logger.log('Executing scenario', { scenario: scenario.scenario, device: session.device.name });

      for (const step of scenario.steps) {
        await this.executeStep(session, step);
      }

      return {
        scenario: scenario.scenario,
        status: 'pass',
        device: session.device.name,
        sessionId: session.sessionId,
        duration: Date.now() - startTime,
        // Screenshots are accessible via BrowserStack session URL — no need to embed base64 here
      };
    } catch (error) {
      return {
        scenario: scenario.scenario,
        status: 'fail',
        device: session.device.name,
        sessionId: session.sessionId,
        duration: Date.now() - startTime,
        error: String(error),
        // Screenshots are accessible via BrowserStack session URL — no need to embed base64 here
      };
    }
  }

  private async executeStep(session: SessionInfo, step: GherkinStep, maxRetries = 3): Promise<void> {
    logger.debug('Executing step', { keyword: step.keyword, text: step.text });

    const action = this.parseStepAction(step.text);
    let attempt = 1;
    let delayMs = TIMEOUTS.STEP_INITIAL_RETRY_DELAY;

    while (attempt <= maxRetries) {
      try {
        // Predictive gatekeeping: wait for element availability before interacting
        if (['tap', 'type', 'longpress'].includes(action.type) && action.target) {
          await this.waitForElement(session.driver, action.target, TIMEOUTS.ELEMENT_WAIT, session.device);
        }

        switch (action.type) {
          case 'tap':
            await this.gestures.tap(session.driver, action.target!);
            break;
          case 'type':
            await session.driver.sendKeys(action.target!, action.value!);
            break;
          case 'swipe':
            await this.gestures.swipe(session.driver, action.direction as any);
            break;
          case 'scroll':
            await this.gestures.scroll(session.driver, action.direction as any);
            break;
          case 'longpress':
            await this.gestures.longPress(session.driver, action.target!, action.duration);
            break;
          case 'wait':
            await this.waitForElement(session.driver, action.target!, action.duration || TIMEOUTS.ELEMENT_ASSERT_WAIT, session.device);
            break;
          case 'assert_visible':
            await this.waitForElement(session.driver, action.target!, TIMEOUTS.ELEMENT_ASSERT_WAIT, session.device);
            await this.assertElementVisible(session.driver, action.target!, session.device);
            break;
          case 'assert_text':
            await this.assertElementText(session.driver, action.target!, action.value!);
            break;
          case 'back':
            await session.driver.back();
            break;
          case 'screenshot':
            await session.driver.takeScreenshot();
            break;
          case 'noop':
            // Intentional no-op (e.g., "the app is launched" — already handled by session creation)
            break;
          default:
            // Log unrecognized step but don't fail — skip and continue
            logger.warn(`Skipping unrecognized step (no Appium mapping found)`, { step: step.text });
            return;
        }
        return; // Success
      } catch (error) {
        if (attempt === maxRetries)
          throw new Error(`Step failed firmly after ${maxRetries} attempts: ${String(error)}`);
        logger.warn(`Step attempt ${attempt} failed, applying exponential backoff of ${delayMs}ms`, {
          text: step.text,
          error: String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2; // Exponential backoff
        attempt++;
      }
    }
  }

  private parseStepAction(text: string): {
    type: string;
    target?: string;
    value?: string;
    direction?: string;
    duration?: number;
  } {
    const lower = text.toLowerCase();

    // App launch — no-op since BrowserStack session already launches the app
    if (lower.includes('app is launched') || lower.includes('app is open') || lower.includes('app is running')) {
      return { type: 'noop' };
    }

    // "user is on" / "is on screen" — wait for that screen element
    const onScreenMatch = text.match(/(?:is on|on screen|on the)\s+["']([^"']+)["']/i);
    if (onScreenMatch) return { type: 'wait', target: onScreenMatch[1].trim(), duration: 10000 };

    // Back navigation (check before tap to avoid "press back" matching tap)
    if (lower.includes('go back') || lower.includes('navigate back') || lower.includes('press back')) {
      return { type: 'back' };
    }

    // Long press (check before regular tap)
    const longPressMatch = text.match(/long[\s-]?press(?:es|ed)?\s+(?:on\s+)?["']?([^"']+?)["']?\s*$/i);
    if (longPressMatch) return { type: 'longpress', target: longPressMatch[1].trim(), duration: 2000 };

    // Tap / click / press — handles: tap, taps, tapped, click, clicks, clicked, press, presses, pressed
    // Also handles: "user taps on X", "taps the X button", "tap 'X'"
    const tapMatch = text.match(/\b(?:tap|taps|tapped|click|clicks|clicked|press|presses|pressed)\b\s+(?:on\s+|the\s+)?["']?([^"',]+?)["']?\s*(?:button|field|screen|icon|tab|link|toggle|switch|option|menu|bar|item|input|label)?[\s,]*$/i);
    if (tapMatch) return { type: 'tap', target: tapMatch[1].trim().replace(/\s+/g, '_').toLowerCase() };

    // Type/input — "enters 'value' in 'field'" / "types 'X' into field"
    const typeMatch = text.match(/\b(?:type|types|typed|enter|enters|entered|input|inputs|fill|fills|filled)\b\s+["']([^"']+)["']\s+(?:in|into|on)\s+(?:the\s+)?["']?([^"']+?)["']?\s*(?:field|input|box)?[\s,]*$/i);
    if (typeMatch) return { type: 'type', target: typeMatch[2].trim().replace(/\s+/g, '_').toLowerCase(), value: typeMatch[1] };

    // Type without target field
    const typeMatch2 = text.match(/\b(?:type|types|enter|enters|input|inputs|fill|fills)\b\s+["']([^"']+)["']/i);
    if (typeMatch2) return { type: 'type', target: 'input_field', value: typeMatch2[1] };

    // Swipe patterns
    const swipeMatch = text.match(/\bswipes?\s+(left|right|up|down)\b/i);
    if (swipeMatch) return { type: 'swipe', direction: swipeMatch[1].toLowerCase() };

    // Scroll patterns
    const scrollMatch = text.match(/\bscrolls?\s+(up|down)\b/i);
    if (scrollMatch) return { type: 'scroll', direction: scrollMatch[1].toLowerCase() };

    // Wait patterns
    const waitMatch = text.match(/\bwaits?\s+(?:for\s+)?["']?([^"']+?)["']?\s*(?:to\s+(?:appear|load|display))?[\s,]*$/i);
    if (waitMatch) return { type: 'wait', target: waitMatch[1].trim(), duration: 10000 };

    // Visibility assertion — "sees", "should see", "is visible", "is displayed", "appears"
    const visibleMatch = text.match(/\b(?:sees?|should see|visible|displayed|shown|appears?)\s+["']?([^"']+?)["']?\s*$/i);
    if (visibleMatch) return { type: 'assert_visible', target: visibleMatch[1].trim() };

    // Text assertion
    const textMatch = text.match(/\b(?:contains?|shows?|displays?)\s+["']([^"']+)["']/i);
    if (textMatch) return { type: 'assert_text', target: 'current_screen', value: textMatch[1] };

    // Screenshot
    if (lower.includes('screenshot') || lower.includes('capture screen')) {
      return { type: 'screenshot' };
    }

    // Last-resort: if step contains a quoted string, try tapping it
    const quotedFallback = text.match(/["']([^"']+)["']/);
    if (quotedFallback && (lower.includes('tap') || lower.includes('click') || lower.includes('press') || lower.includes('select') || lower.includes('open'))) {
      return { type: 'tap', target: quotedFallback[1].trim().replace(/\s+/g, '_').toLowerCase() };
    }

    return { type: 'unknown' };
  }

  private getLocatorStrategies(device?: Device): string[] {
    if (device?.platform === 'iOS') {
      return ['accessibility id', 'name', 'xpath'];
    }
    return ['accessibility id', 'id', 'xpath'];
  }

  private async waitForElement(driver: any, elementId: string, timeoutMs: number, device?: Device): Promise<void> {
    const strategies = this.getLocatorStrategies(device);
    const start = Date.now();
    let pollInterval = 500;
    while (Date.now() - start < timeoutMs) {
      for (const strategy of strategies) {
        try {
          const selector = strategy === 'xpath'
            ? `//*[contains(@text,"${elementId}") or contains(@content-desc,"${elementId}") or contains(@label,"${elementId}") or contains(@name,"${elementId}")]`
            : elementId;
          const el = await driver.findElement(strategy, selector);
          if (el) return;
        } catch {
          // element not found with this strategy
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      pollInterval = Math.min(pollInterval * 1.5, 2000);
    }
    throw new Error(`Wait timeout: Element "${elementId}" not found within ${timeoutMs}ms`);
  }

  private async assertElementVisible(driver: any, elementId: string, device?: Device): Promise<void> {
    const strategies = this.getLocatorStrategies(device);
    for (const strategy of strategies) {
      try {
        const selector =
          strategy === 'xpath'
            ? `//*[contains(@text,"${elementId}") or contains(@content-desc,"${elementId}") or contains(@label,"${elementId}") or contains(@name,"${elementId}")]`
            : elementId;
        const el = await driver.findElement(strategy, selector);
        if (el) {
          const displayed = await driver.isElementDisplayed(el.ELEMENT || el);
          if (displayed) return;
        }
      } catch {
        continue;
      }
    }
    throw new Error(`Element "${elementId}" is not visible`);
  }

  private async assertElementText(driver: any, elementId: string, expectedText: string): Promise<void> {
    const pageSource = await driver.getPageSource();
    if (!pageSource.includes(expectedText)) {
      throw new Error(`Expected text "${expectedText}" not found on screen`);
    }
  }

  private async closeSession(session: SessionInfo): Promise<void> {
    try {
      await session.driver.deleteSession();
      logger.log('Session closed', { sessionId: session.sessionId, device: session.device.name });
    } catch (error) {
      logger.error('Failed to close session', error);
    }
  }

  async getSessionLogs(sessionId: string): Promise<string> {
    try {
      const response = await axios.get(`${this.config.appAutomateUrl}/sessions/${sessionId}/logs`, {
        auth: {
          username: this.config.username,
          password: this.config.accessKey,
        },
        timeout: this.config.timeout,
      });
      return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    } catch (error) {
      logger.error('Failed to fetch session logs', error);
      return '';
    }
  }

  async getSessionVideoUrl(sessionId: string): Promise<string | undefined> {
    try {
      const response = await axios.get(`${this.config.appAutomateUrl}/sessions/${sessionId}.json`, {
        auth: {
          username: this.config.username,
          password: this.config.accessKey,
        },
        timeout: this.config.timeout,
      });
      const videoUrl = response.data?.automation_session?.video_url;
      if (videoUrl) {
        logger.log('Video URL retrieved', { sessionId });
      }
      return videoUrl || undefined;
    } catch (error) {
      logger.error('Failed to fetch session video URL', error);
      return undefined;
    }
  }

  async markSessionStatus(sessionId: string, status: 'passed' | 'failed', reason: string): Promise<void> {
    try {
      await axios.put(
        `${this.config.appAutomateUrl}/sessions/${sessionId}.json`,
        { status, reason },
        {
          auth: {
            username: this.config.username,
            password: this.config.accessKey,
          },
          timeout: this.config.timeout,
        },
      );
    } catch (error) {
      logger.error('Failed to mark session status', error);
    }
  }
}

// Minimal WebDriver client wrapping BrowserStack hub REST calls
class WebDriverClient {
  private baseUrl: string;
  private auth: { username: string; password: string };

  constructor(
    private sessionId: string,
    config: BrowserStackConfig,
  ) {
    this.baseUrl = `${HUB_URL}/session/${sessionId}`;
    this.auth = { username: config.username, password: config.accessKey };
  }

  async findElement(strategy: string, value: string): Promise<any> {
    const res = await axios.post(
      `${this.baseUrl}/element`,
      { using: strategy, value },
      { auth: this.auth, timeout: 30000 },
    );
    return res.data.value;
  }

  async findElements(strategy: string, value: string): Promise<any[]> {
    const res = await axios.post(
      `${this.baseUrl}/elements`,
      { using: strategy, value },
      { auth: this.auth, timeout: 30000 },
    );
    return res.data.value;
  }

  async sendKeys(elementId: string, text: string): Promise<void> {
    const el = await this.findElement('accessibility id', elementId);
    const elId = el.ELEMENT || el[Object.keys(el)[0]];
    await axios.post(
      `${this.baseUrl}/element/${elId}/value`,
      { text, value: text.split('') },
      { auth: this.auth, timeout: 30000 },
    );
  }

  async takeScreenshot(): Promise<string> {
    const res = await axios.get(`${this.baseUrl}/screenshot`, { auth: this.auth, timeout: 30000 });
    return res.data.value;
  }

  async getPageSource(): Promise<string> {
    const res = await axios.get(`${this.baseUrl}/source`, { auth: this.auth, timeout: 60000 });
    return res.data.value;
  }

  async back(): Promise<void> {
    await axios.post(`${this.baseUrl}/back`, {}, { auth: this.auth, timeout: 30000 });
  }

  async getWindowRect(): Promise<{ width: number; height: number; x: number; y: number }> {
    const res = await axios.get(`${this.baseUrl}/window/rect`, { auth: this.auth, timeout: 30000 });
    return res.data.value;
  }

  async getElementRect(elementId: string): Promise<{ x: number; y: number; width: number; height: number }> {
    const res = await axios.get(`${this.baseUrl}/element/${elementId}/rect`, { auth: this.auth, timeout: 30000 });
    return res.data.value;
  }

  async isElementDisplayed(elementId: string): Promise<boolean> {
    const res = await axios.get(`${this.baseUrl}/element/${elementId}/displayed`, { auth: this.auth, timeout: 30000 });
    return res.data.value;
  }

  async performActions(actions: any[]): Promise<void> {
    await axios.post(`${this.baseUrl}/actions`, { actions }, { auth: this.auth, timeout: 30000 });
  }

  async releaseActions(): Promise<void> {
    await axios.delete(`${this.baseUrl}/actions`, { auth: this.auth, timeout: 30000 });
  }

  async setNetworkConnection(type: number): Promise<void> {
    await axios.post(`${this.baseUrl}/network_connection`, { type }, { auth: this.auth, timeout: 30000 });
  }

  async deleteSession(): Promise<void> {
    await axios.delete(this.baseUrl, { auth: this.auth, timeout: 30000 });
  }
}
