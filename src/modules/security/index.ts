import { PipelineContext, ModuleResult } from '../../types';
import { Logger } from '../../utils/logger';
import { MobsfScanner, SecurityIssue } from './mobsf-scanner';
import { SslPinningValidator } from './ssl-pinning';
import { DataStorageChecker } from './data-storage';
import { PiiScanner } from './pii-scanner';
import { RootJailbreakDetector } from './root-jailbreak';

export async function runSecurity(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('Security');
  logger.log('Starting security module');

  const allIssues: SecurityIssue[] = [];
  const platform = context.codeAnalysis?.framework === 'swift' ? 'ios' : 'android';

  try {
    // MobSF static analysis
    const mobsfApiKey = process.env.MOBSF_API_KEY;
    const appPath = platform === 'android' ? context.appBuild?.androidAppUrl : context.appBuild?.iosAppUrl;

    if (mobsfApiKey && appPath) {
      try {
        const mobsf = new MobsfScanner(process.env.MOBSF_URL);
        const scanId = await mobsf.scan(appPath, mobsfApiKey);
        const mobsfIssues = await mobsf.getResults(scanId, mobsfApiKey);
        allIssues.push(...mobsfIssues);
        logger.log('MobSF scan completed', { issueCount: mobsfIssues.length });
      } catch (err) {
        logger.warn('MobSF scan failed, continuing with other checks', err);
      }
    } else {
      logger.log('MobSF scan skipped (no API key or app path)');
    }

    // Driver-dependent checks
    const driver = (context as any).driver;
    if (driver) {
      // SSL Pinning
      try {
        const sslValidator = new SslPinningValidator();
        const endpoints = (context.codeAnalysis?.apiEndpoints || []).map((e) => e.path);
        if (endpoints.length > 0) {
          const sslResult = await sslValidator.validate(driver, endpoints);
          for (const vuln of sslResult.vulnerabilities) {
            allIssues.push({
              type: 'ssl_pinning',
              severity: 'high',
              description: vuln,
              location: 'network',
              remediation:
                'Implement SSL certificate pinning using OkHttp CertificatePinner (Android) or URLSession pinning (iOS)',
            });
          }
        }
      } catch (err) {
        logger.warn('SSL pinning check failed', err);
      }

      // Data storage
      try {
        const storageChecker = new DataStorageChecker();
        const storageResult = await storageChecker.checkInsecureStorage(driver, platform);
        allIssues.push(...storageResult.issues);

        const encryptionResult = await storageChecker.checkEncryption(driver, platform);
        allIssues.push(...(encryptionResult.issues as SecurityIssue[]));
      } catch (err) {
        logger.warn('Data storage check failed', err);
      }

      // Root/Jailbreak detection
      try {
        const rootDetector = new RootJailbreakDetector();
        const rootResult = await rootDetector.testDetection(driver, platform);
        if (!rootResult.detected) {
          allIssues.push({
            type: 'root_jailbreak',
            severity: 'medium',
            description: `App does not detect ${platform === 'android' ? 'rooted' : 'jailbroken'} devices`,
            location: 'app',
            remediation:
              platform === 'android'
                ? 'Implement root detection using SafetyNet/Play Integrity API'
                : 'Implement jailbreak detection checks',
          });
        }
      } catch (err) {
        logger.warn('Root/jailbreak detection test failed', err);
      }
    }

    // PII scanning on collected network logs
    const networkLogs = (context as any).networkLogs as string | undefined;
    if (networkLogs) {
      const piiScanner = new PiiScanner();
      const piiResult = piiScanner.scanNetworkTraffic(networkLogs);
      for (const instance of piiResult.instances) {
        allIssues.push({
          type: 'pii_exposure',
          severity: instance.severity,
          description: `${instance.type} found in network traffic: ${instance.value}`,
          location: instance.location,
          remediation: 'Encrypt sensitive data in transit and avoid logging PII',
        });
      }
    }

    const critical = allIssues.filter((i) => i.severity === 'critical').length;
    const high = allIssues.filter((i) => i.severity === 'high').length;

    logger.log('Security module completed', {
      totalIssues: allIssues.length,
      critical,
      high,
    });

    return {
      moduleName: 'security',
      status: critical > 0 ? 'error' : high > 0 ? 'warning' : 'success',
      data: {
        issues: allIssues,
        summary: { total: allIssues.length, critical, high },
      },
    };
  } catch (err) {
    logger.error('Security module failed', err);
    return { moduleName: 'security', status: 'error', error: String(err) };
  }
}
