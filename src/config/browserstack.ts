export interface BrowserStackConfig {
  username: string;
  accessKey: string;
  baseUrl: string;
  appAutomateUrl: string;
  timeout: number;
  maxRetries: number;
  retryDelayMs: number;
}

export function getBrowserStackConfig(): BrowserStackConfig {
  const username = process.env.BROWSERSTACK_USERNAME;
  const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;

  if (!username || !accessKey) {
    throw new Error('BrowserStack credentials not found in environment variables');
  }

  return {
    username,
    accessKey,
    baseUrl: 'https://api.browserstack.com',
    appAutomateUrl: 'https://api.browserstack.com/app-automate',
    timeout: 60000, // 60 seconds
    maxRetries: 3,
    retryDelayMs: 1000,
  };
}

export const BROWSERSTACK_NETWORK_CONDITIONS = {
  FAST_4G: {
    networkName: '4G',
    downloadSpeed: 4000,
    uploadSpeed: 3000,
    latency: 50,
  },
  SLOW_3G: {
    networkName: 'Slow 3G',
    downloadSpeed: 400,
    uploadSpeed: 400,
    latency: 400,
  },
  OFFLINE: {
    networkName: 'Offline',
    downloadSpeed: 0,
    uploadSpeed: 0,
    latency: 0,
  },
};
