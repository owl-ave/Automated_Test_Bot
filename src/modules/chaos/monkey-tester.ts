import { Logger } from '../../utils/logger';

export interface MonkeyTestResult {
  crashed: boolean;
  actionsPerformed: number;
  errors: string[];
  durationMs: number;
  crashLog?: string;
  screenshot?: string;
}

type MonkeyAction = 'tap' | 'swipe' | 'scroll' | 'back' | 'longpress';

export class MonkeyTester {
  private logger = new Logger('MonkeyTester');

  async runMonkeyTest(
    driver: any,
    durationMs: number = 30000,
    actionsPerSecond: number = 2,
  ): Promise<MonkeyTestResult> {
    const result: MonkeyTestResult = {
      crashed: false,
      actionsPerformed: 0,
      errors: [],
      durationMs: 0,
    };

    const startTime = Date.now();
    const intervalMs = 1000 / actionsPerSecond;
    let screenSize: { width: number; height: number };

    try {
      screenSize = await driver.getWindowSize();
    } catch (err) {
      result.errors.push(`Failed to get screen size: ${err}`);
      result.crashed = true;
      return result;
    }

    this.logger.log('Starting monkey test', { durationMs, actionsPerSecond });

    while (Date.now() - startTime < durationMs) {
      try {
        const action = this.randomAction();
        await this.performAction(driver, action, screenSize);
        result.actionsPerformed++;

        // Check for crash after each action
        const crashed = await this.checkForCrash(driver);
        if (crashed) {
          result.crashed = true;
          result.crashLog = await this.captureCrashLog(driver);
          result.screenshot = await driver.takeScreenshot().catch(() => undefined);
          result.errors.push(`App crashed after ${result.actionsPerformed} actions (${action})`);
          this.logger.error('App crashed during monkey test', { action, actionsPerformed: result.actionsPerformed });
          break;
        }

        // Check for ANR (Android Not Responding) dialogs
        const anrDetected = await this.checkForANR(driver);
        if (anrDetected) {
          result.errors.push(`ANR detected after ${result.actionsPerformed} actions`);
          // Dismiss ANR dialog and continue
          await this.dismissANR(driver);
        }

        // Check for unexpected system dialogs
        await this.dismissSystemDialogs(driver);

        await this.pause(intervalMs);
      } catch (err) {
        const errorMsg = String(err);
        // Session errors indicate a crash
        if (errorMsg.includes('session') || errorMsg.includes('NoSuchDriver') || errorMsg.includes('terminated')) {
          result.crashed = true;
          result.errors.push(`Fatal error: ${errorMsg}`);
          break;
        }
        result.errors.push(`Action error: ${errorMsg}`);
      }
    }

    result.durationMs = Date.now() - startTime;

    if (!result.crashed) {
      result.screenshot = await driver.takeScreenshot().catch(() => undefined);
    }

    this.logger.log('Monkey test complete', {
      crashed: result.crashed,
      actionsPerformed: result.actionsPerformed,
      errors: result.errors.length,
      durationMs: result.durationMs,
    });

    return result;
  }

  private randomAction(): MonkeyAction {
    const actions: MonkeyAction[] = ['tap', 'tap', 'tap', 'swipe', 'scroll', 'back', 'longpress'];
    // Weighted: taps are most common
    return actions[Math.floor(Math.random() * actions.length)];
  }

  private async performAction(
    driver: any,
    action: MonkeyAction,
    screenSize: { width: number; height: number },
  ): Promise<void> {
    // Avoid system bars: use safe zone (10%-90% of screen)
    const safeX = () => Math.floor(screenSize.width * (0.1 + Math.random() * 0.8));
    const safeY = () => Math.floor(screenSize.height * (0.15 + Math.random() * 0.7));

    switch (action) {
      case 'tap': {
        const x = safeX();
        const y = safeY();
        await driver.touchAction([{ action: 'tap', x, y }]);
        break;
      }

      case 'swipe': {
        const startX = safeX();
        const startY = safeY();
        const endX = safeX();
        const endY = safeY();
        await driver.touchAction([
          { action: 'press', x: startX, y: startY },
          { action: 'wait', ms: 200 },
          { action: 'moveTo', x: endX, y: endY },
          { action: 'release' },
        ]);
        break;
      }

      case 'scroll': {
        const x = screenSize.width / 2;
        const startScrollY = Math.floor(screenSize.height * 0.7);
        const endScrollY = Math.floor(screenSize.height * 0.3);
        const direction = Math.random() > 0.5 ? 1 : -1;
        await driver.touchAction([
          { action: 'press', x, y: direction > 0 ? startScrollY : endScrollY },
          { action: 'wait', ms: 300 },
          { action: 'moveTo', x, y: direction > 0 ? endScrollY : startScrollY },
          { action: 'release' },
        ]);
        break;
      }

      case 'back': {
        try {
          await driver.back();
        } catch {
          /* back may not be supported on iOS home */
        }
        break;
      }

      case 'longpress': {
        const x = safeX();
        const y = safeY();
        await driver.touchAction([{ action: 'press', x, y }, { action: 'wait', ms: 1500 }, { action: 'release' }]);
        break;
      }
    }
  }

  private async checkForCrash(driver: any): Promise<boolean> {
    try {
      // If we can get page source, app is alive
      const source = await driver.getPageSource();
      return !source || source.length === 0;
    } catch {
      return true;
    }
  }

  private async checkForANR(driver: any): Promise<boolean> {
    try {
      const source = await driver.getPageSource();
      return source.includes("isn't responding") || source.includes('ANR') || source.includes('not responding');
    } catch {
      return false;
    }
  }

  private async dismissANR(driver: any): Promise<void> {
    try {
      // Try to click "Wait" button on ANR dialog
      const waitBtn = await driver.$('//*[@text="Wait"]').catch(() => null);
      if (waitBtn) {
        await waitBtn.click();
        return;
      }
      // Try "Close app" button
      const closeBtn = await driver.$('//*[@text="Close app"]').catch(() => null);
      if (closeBtn) {
        await closeBtn.click();
      }
    } catch {
      /* best effort */
    }
  }

  private async dismissSystemDialogs(driver: any): Promise<void> {
    try {
      // Dismiss common system dialogs (permissions, alerts)
      const allowBtn = await driver.$('//*[@text="Allow"]').catch(() => null);
      if (allowBtn && (await allowBtn.isDisplayed().catch(() => false))) {
        await allowBtn.click();
        return;
      }

      const okBtn = await driver.$('//*[@text="OK"]').catch(() => null);
      if (okBtn && (await okBtn.isDisplayed().catch(() => false))) {
        await okBtn.click();
        return;
      }

      const dismissBtn = await driver.$('//*[@text="Dismiss"]').catch(() => null);
      if (dismissBtn && (await dismissBtn.isDisplayed().catch(() => false))) {
        await dismissBtn.click();
      }
    } catch {
      /* best effort */
    }
  }

  private async captureCrashLog(driver: any): Promise<string> {
    try {
      const logs = await driver.getLogs('logcat').catch(() => []);
      // Get last 50 log entries around crash
      const recentLogs = logs.slice(-50);
      return recentLogs.map((entry: any) => `${entry.timestamp} ${entry.level} ${entry.message}`).join('\n');
    } catch {
      return 'Unable to capture crash log';
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
