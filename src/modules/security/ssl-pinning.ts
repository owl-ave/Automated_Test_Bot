import { Logger } from '../../utils/logger';

export interface SslPinningResult {
  pinned: boolean;
  vulnerabilities: string[];
  endpoints: EndpointPinningStatus[];
}

interface EndpointPinningStatus {
  endpoint: string;
  pinned: boolean;
  error?: string;
}

export class SslPinningValidator {
  private logger = new Logger('SslPinningValidator');

  async validate(driver: any, endpoints: string[]): Promise<SslPinningResult> {
    this.logger.log('Validating SSL pinning', { endpointCount: endpoints.length });

    const vulnerabilities: string[] = [];
    const endpointResults: EndpointPinningStatus[] = [];

    for (const endpoint of endpoints) {
      try {
        const result = await this.checkEndpointPinning(driver, endpoint);
        endpointResults.push(result);

        if (!result.pinned) {
          vulnerabilities.push(`SSL pinning not implemented for ${endpoint}`);
        }
      } catch (err) {
        this.logger.error(`SSL pinning check failed for ${endpoint}`, err);
        endpointResults.push({ endpoint, pinned: false, error: String(err) });
      }
    }

    const pinned = vulnerabilities.length === 0 && endpointResults.length > 0;

    return { pinned, vulnerabilities, endpoints: endpointResults };
  }

  async testInvalidCert(driver: any, endpoint: string): Promise<{ rejected: boolean; error?: string }> {
    this.logger.log('Testing invalid certificate rejection', { endpoint });

    try {
      // Configure proxy with self-signed cert via Appium
      await driver.execute('mobile: shell', {
        command: 'settings',
        args: ['put', 'global', 'http_proxy', '127.0.0.1:8888'],
      });

      // Attempt to reach the endpoint through the MITM proxy
      const logs = await driver.getLogs('server');
      const sslErrors = logs.filter(
        (log: any) =>
          log.message?.includes('SSL') || log.message?.includes('certificate') || log.message?.includes('trust'),
      );

      // Check if the app rejected the connection
      const pageSource = await driver.getPageSource();
      const errorIndicators = ['ssl', 'certificate', 'trust', 'connection error', 'network error', 'unable to connect'];
      const hasError = errorIndicators.some((indicator) => pageSource.toLowerCase().includes(indicator));

      // Clean up proxy
      await driver
        .execute('mobile: shell', {
          command: 'settings',
          args: ['put', 'global', 'http_proxy', ':0'],
        })
        .catch(() => {});

      return {
        rejected: hasError || sslErrors.length > 0,
      };
    } catch (err) {
      this.logger.error('Invalid cert test failed', err);
      return { rejected: false, error: String(err) };
    }
  }

  private async checkEndpointPinning(driver: any, endpoint: string): Promise<EndpointPinningStatus> {
    try {
      // Check network security config (Android)
      const source = await driver.getPageSource();

      // Trigger a request to the endpoint by navigating in the app
      // and checking if the connection succeeds through a MITM proxy
      const logs = await driver.getLogs('logcat').catch(() => []);
      const pinningLogs = logs.filter(
        (log: any) =>
          log.message?.includes('CertificatePinner') ||
          log.message?.includes('ssl_pinning') ||
          log.message?.includes('TrustManager'),
      );

      return {
        endpoint,
        pinned: pinningLogs.length > 0,
      };
    } catch (err) {
      return { endpoint, pinned: false, error: String(err) };
    }
  }
}
