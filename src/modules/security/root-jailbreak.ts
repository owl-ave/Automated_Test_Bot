import { Logger } from '../../utils/logger';

export interface RootJailbreakResult {
  detected: boolean;
  behavior: 'blocked' | 'warned' | 'none';
  details: string;
}

export class RootJailbreakDetector {
  private logger = new Logger('RootJailbreakDetector');

  async testDetection(driver: any, platform: string): Promise<RootJailbreakResult> {
    this.logger.log('Testing root/jailbreak detection', { platform });

    try {
      if (platform === 'android') {
        return await this.testAndroidRootDetection(driver);
      } else if (platform === 'ios') {
        return await this.testIosJailbreakDetection(driver);
      }

      return { detected: false, behavior: 'none', details: 'Unsupported platform' };
    } catch (err) {
      this.logger.error('Root/jailbreak detection test failed', err);
      return { detected: false, behavior: 'none', details: String(err) };
    }
  }

  private async testAndroidRootDetection(driver: any): Promise<RootJailbreakResult> {
    // Check common root indicators
    const rootIndicators = [
      { command: 'which', args: ['su'], label: 'su binary' },
      { command: 'ls', args: ['/system/app/Superuser.apk'], label: 'Superuser.apk' },
      { command: 'ls', args: ['/system/xbin/su'], label: 'su in xbin' },
    ];

    let isRooted = false;
    for (const indicator of rootIndicators) {
      try {
        const result = await driver.execute('mobile: shell', {
          command: indicator.command,
          args: indicator.args,
        });
        if (result && !result.includes('not found')) {
          isRooted = true;
          break;
        }
      } catch {
        /* not rooted or command not available */
      }
    }

    // Check app behavior on rooted device
    const pageSource = await driver.getPageSource();
    const blockedKeywords = ['rooted device', 'root detected', 'cannot run', 'security risk'];
    const warnedKeywords = ['warning', 'rooted', 'risk', 'proceed anyway'];

    const isBlocked = blockedKeywords.some((kw) => pageSource.toLowerCase().includes(kw));
    const isWarned = warnedKeywords.some((kw) => pageSource.toLowerCase().includes(kw));

    let behavior: RootJailbreakResult['behavior'] = 'none';
    if (isBlocked) behavior = 'blocked';
    else if (isWarned) behavior = 'warned';

    // Also check logcat for root detection logs
    try {
      const logs = await driver.getLogs('logcat');
      const rootLogs = logs.filter(
        (log: any) => log.message?.toLowerCase().includes('root') || log.message?.toLowerCase().includes('tamper'),
      );
      if (rootLogs.length > 0 && behavior === 'none') {
        behavior = 'warned';
      }
    } catch {
      /* logs not accessible */
    }

    return {
      detected: behavior !== 'none',
      behavior,
      details: isRooted
        ? `Device appears rooted. App behavior: ${behavior}`
        : `Device not rooted. Root detection cannot be fully verified.`,
    };
  }

  private async testIosJailbreakDetection(driver: any): Promise<RootJailbreakResult> {
    // Check app behavior for jailbreak indicators
    const pageSource = await driver.getPageSource();
    const blockedKeywords = ['jailbroken', 'jailbreak detected', 'cannot run', 'security risk'];
    const warnedKeywords = ['warning', 'jailbreak', 'risk', 'proceed'];

    const isBlocked = blockedKeywords.some((kw) => pageSource.toLowerCase().includes(kw));
    const isWarned = warnedKeywords.some((kw) => pageSource.toLowerCase().includes(kw));

    let behavior: RootJailbreakResult['behavior'] = 'none';
    if (isBlocked) behavior = 'blocked';
    else if (isWarned) behavior = 'warned';

    // Check syslog for jailbreak detection
    try {
      const logs = await driver.getLogs('syslog').catch(() => []);
      const jailbreakLogs = logs.filter(
        (log: any) =>
          log.message?.toLowerCase().includes('jailbreak') ||
          log.message?.toLowerCase().includes('cydia') ||
          log.message?.toLowerCase().includes('substrate'),
      );
      if (jailbreakLogs.length > 0 && behavior === 'none') {
        behavior = 'warned';
      }
    } catch {
      /* logs not accessible */
    }

    return {
      detected: behavior !== 'none',
      behavior,
      details: `Jailbreak detection behavior: ${behavior}`,
    };
  }
}
