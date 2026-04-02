import { Device } from './devices';

export interface AppiumCapabilities {
  platformName: 'Android' | 'iOS';
  'appium:automationName': 'UiAutomator2' | 'XCUITest';
  'appium:app': string;
  'appium:deviceName': string;
  'appium:osVersion': string;
  'bstack:options': {
    userName: string;
    accessKey: string;
    projectName: string;
    buildName: string;
    sessionName: string;
    appiumVersion?: string;
    networkLogsEnabled?: boolean;
    interactiveDebugging?: boolean;
    autoGrantPermissions?: boolean;
  };
  [key: string]: unknown;
}

export function getAndroidCapabilities(
  appUrl: string,
  deviceName: string,
  osVersion: string,
  buildName: string,
  sessionName: string,
): AppiumCapabilities {
  return {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': appUrl,
    'appium:deviceName': deviceName,
    'appium:osVersion': osVersion,
    'appium:autoGrantPermissions': true,
    'appium:autoWebview': false,
    'appium:ensureWebviewsHavePages': true,
    'bstack:options': {
      userName: process.env.BROWSERSTACK_USERNAME || '',
      accessKey: process.env.BROWSERSTACK_ACCESS_KEY || '',
      projectName: 'Automated Testing Bot',
      buildName,
      sessionName,
      appiumVersion: '2.0.0',
      networkLogsEnabled: true,
      interactiveDebugging: false,
    },
  };
}

export function getIosCapabilities(
  appUrl: string,
  deviceName: string,
  osVersion: string,
  buildName: string,
  sessionName: string,
): AppiumCapabilities {
  return {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:app': appUrl,
    'appium:deviceName': deviceName,
    'appium:osVersion': osVersion,
    'appium:usePrebuiltWDA': true,
    'appium:preventWDAAttachments': true,
    'appium:useNewWDA': false,
    'appium:autoGrantPermissions': true,
    'bstack:options': {
      userName: process.env.BROWSERSTACK_USERNAME || '',
      accessKey: process.env.BROWSERSTACK_ACCESS_KEY || '',
      projectName: 'Automated Testing Bot',
      buildName,
      sessionName,
      appiumVersion: '2.0.0',
      networkLogsEnabled: true,
      interactiveDebugging: false,
    },
  };
}

export function getAppiumCapabilities(device: Device, appUrl: string): AppiumCapabilities {
  const buildName = `PR-${Date.now()}`;
  const sessionName = `${device.name} Test`;

  if (device.platform === 'iOS') {
    return getIosCapabilities(appUrl, device.device, device.os_version, buildName, sessionName);
  }
  return getAndroidCapabilities(appUrl, device.device, device.os_version, buildName, sessionName);
}
