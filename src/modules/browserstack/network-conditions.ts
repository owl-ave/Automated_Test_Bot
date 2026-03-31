import axios from 'axios';
import { getBrowserStackConfig, BrowserStackConfig, BROWSERSTACK_NETWORK_CONDITIONS } from '../../config/browserstack';
import { Logger } from '../../utils/logger';

const logger = new Logger('NetworkSimulator');

export type NetworkCondition = '4g' | '3g' | '2g' | 'offline' | 'reset';

interface NetworkProfile {
  networkName: string;
  downloadSpeed: number;
  uploadSpeed: number;
  latency: number;
}

const NETWORK_PROFILES: Record<NetworkCondition, NetworkProfile> = {
  '4g': BROWSERSTACK_NETWORK_CONDITIONS.FAST_4G,
  '3g': BROWSERSTACK_NETWORK_CONDITIONS.SLOW_3G,
  '2g': {
    networkName: '2G',
    downloadSpeed: 50,
    uploadSpeed: 25,
    latency: 800,
  },
  offline: BROWSERSTACK_NETWORK_CONDITIONS.OFFLINE,
  reset: {
    networkName: 'No throttling',
    downloadSpeed: -1,
    uploadSpeed: -1,
    latency: 0,
  },
};

export class NetworkSimulator {
  private config: BrowserStackConfig;

  constructor() {
    this.config = getBrowserStackConfig();
  }

  async setNetworkCondition(sessionId: string, condition: NetworkCondition): Promise<void> {
    const profile = NETWORK_PROFILES[condition];
    logger.log('Setting network condition', { sessionId, condition, profile: profile.networkName });

    try {
      await axios.put(
        `${this.config.appAutomateUrl}/sessions/${sessionId}/update_network.json`,
        {
          networkProfile: profile.networkName,
          downloadSpeed: profile.downloadSpeed,
          uploadSpeed: profile.uploadSpeed,
          latency: profile.latency,
        },
        {
          auth: {
            username: this.config.username,
            password: this.config.accessKey,
          },
          timeout: this.config.timeout,
        },
      );

      logger.log('Network condition set', { sessionId, condition });
    } catch (error) {
      logger.error('Failed to set network condition', error);
      throw error;
    }
  }

  async resetNetwork(sessionId: string): Promise<void> {
    await this.setNetworkCondition(sessionId, 'reset');
  }

  async setAirplaneMode(driver: any, enabled: boolean): Promise<void> {
    logger.log('Setting airplane mode', { enabled });
    if (enabled) {
      await driver.setNetworkConnection(1); // airplane mode
    } else {
      await driver.setNetworkConnection(6); // WiFi + Data
    }
  }

  async setWifiOnly(driver: any): Promise<void> {
    await driver.setNetworkConnection(2); // WiFi only
  }

  async setDataOnly(driver: any): Promise<void> {
    await driver.setNetworkConnection(4); // Mobile data only
  }
}
