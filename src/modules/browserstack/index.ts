import { PipelineContext, ModuleResult, TestResult } from '../../types';
import { TestExecutor } from './executor';
import { getDevicesForPlatform, getMinimalDeviceSet } from './device-matrix';
import { Logger } from '../../utils/logger';

const logger = new Logger('BrowserStack');

export async function runBrowserStack(context: PipelineContext): Promise<ModuleResult> {
  try {
    let scenarios = context.scenariosBdd;

    // Auto-generate a minimal smoke test if no scenarios were produced
    if (!scenarios || scenarios.length === 0) {
      logger.warn('No BDD scenarios — injecting minimal smoke test (app launch + main screen check)');
      scenarios = [{
        feature: 'Smoke Test',
        scenario: 'App launches successfully',
        steps: [
          { keyword: 'Given', text: 'the app is launched' },
          { keyword: 'Then', text: 'user should see "main_screen"' },
        ],
      }];
      context.scenariosBdd = scenarios;
    }

    const executor = new TestExecutor();

    // Determine platform from code analysis and available app builds
    const framework = context.codeAnalysis?.framework;
    const hasAndroid = !!context.appBuild?.androidAppUrl;
    const hasIos = !!context.appBuild?.iosAppUrl;
    const platform: 'android' | 'ios' | 'both' =
      framework === 'swift' ? 'ios' :
      framework === 'kotlin' ? 'android' :
      (hasAndroid && hasIos) ? 'both' :
      hasAndroid ? 'android' :
      hasIos ? 'ios' :
      'both';

    // Use minimal device set for quick PR checks, full matrix for release branches
    const isReleaseBranch = context.branch.startsWith('release/') || context.branch === 'main';
    const devices = isReleaseBranch ? getDevicesForPlatform(platform) : getMinimalDeviceSet();

    logger.log('Execution plan', {
      scenarios: scenarios.length,
      devices: devices.map((d) => d.name),
      isReleaseBranch,
    });

    // Upload apps if not already uploaded
    const androidAppUrl = context.appBuild?.androidAppUrl;
    const iosAppUrl = context.appBuild?.iosAppUrl;

    if (!androidAppUrl && !iosAppUrl) {
      return {
        moduleName: 'BrowserStack',
        status: 'error',
        error: 'No app URLs available. App build may have failed.',
      };
    }

    const allResults: TestResult[] = [];

    // Run on Android devices
    const androidDevices = devices.filter((d) => d.platform === 'Android');
    if (androidAppUrl && androidDevices.length > 0) {
      logger.log('Running Android tests', { devices: androidDevices.length, scenarios: scenarios.length });
      const androidResults = await executor.executeTests(androidAppUrl, scenarios, androidDevices);
      allResults.push(...androidResults);
    }

    // Run on iOS devices — filter to devices that meet the app's minimum OS version
    const minIosVersion = context.codeAnalysis?.minIosVersion;
    const iosDevices = devices.filter((d) => {
      if (d.platform !== 'iOS') return false;
      if (minIosVersion && parseFloat(d.os_version) < parseFloat(minIosVersion)) {
        logger.warn(`Skipping ${d.name} (iOS ${d.os_version}) — app requires iOS ${minIosVersion}+`);
        return false;
      }
      return true;
    });
    if (iosAppUrl && iosDevices.length > 0) {
      logger.log('Running iOS tests', { devices: iosDevices.length, scenarios: scenarios.length });
      const iosResults = await executor.executeTests(iosAppUrl, scenarios, iosDevices);
      allResults.push(...iosResults);
    }

    if (allResults.length === 0) {
      logger.warn('No tests were executed — no compatible devices found or no scenarios matched', {
        iosDevices: iosDevices.length,
        androidDevices: androidDevices.length,
        minIosVersion,
      });
      return { moduleName: 'BrowserStack', status: 'warning', error: 'No compatible devices available for testing' };
    }

    // Store results in context
    context.testResults = allResults;

    // Compute summary
    const passed = allResults.filter((r) => r.status === 'pass').length;
    const failed = allResults.filter((r) => r.status === 'fail').length;
    const warned = allResults.filter((r) => r.status === 'warn').length;
    const total = allResults.length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    logger.log('Execution complete', { total, passed, failed, warned, passRate });

    const status = failed > 0 ? 'warning' : 'success';

    return {
      moduleName: 'BrowserStack',
      status,
      data: {
        results: allResults,
        summary: { total, passed, failed, warned, passRate },
        devices: devices.map((d) => d.name),
      },
    };
  } catch (error) {
    logger.error('BrowserStack module failed', error);
    return { moduleName: 'BrowserStack', status: 'error', error: String(error) };
  }
}
