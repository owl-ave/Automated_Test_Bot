import { Logger } from '../../utils/logger';

export interface SecurityIssue {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  location: string;
  remediation: string;
}

export interface DataStorageReport {
  issues: SecurityIssue[];
}

export class DataStorageChecker {
  private logger = new Logger('DataStorageChecker');

  async checkInsecureStorage(driver: any, platform: string): Promise<DataStorageReport> {
    this.logger.log('Checking insecure data storage', { platform });
    const issues: SecurityIssue[] = [];

    try {
      if (platform === 'android') {
        issues.push(...(await this.checkAndroidStorage(driver)));
      } else if (platform === 'ios') {
        issues.push(...(await this.checkIosStorage(driver)));
      }
    } catch (err) {
      this.logger.error('Data storage check failed', err);
    }

    return { issues };
  }

  async checkEncryption(driver: any, platform: string): Promise<DataStorageReport> {
    this.logger.log('Checking data encryption', { platform });
    const issues: SecurityIssue[] = [];

    try {
      if (platform === 'android') {
        issues.push(...(await this.checkAndroidEncryption(driver)));
      } else if (platform === 'ios') {
        issues.push(...(await this.checkIosEncryption(driver)));
      }
    } catch (err) {
      this.logger.error('Encryption check failed', err);
    }

    return { issues };
  }

  private async checkAndroidStorage(driver: any): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];
    const packageName = await driver.getCurrentPackage().catch(() => 'unknown');

    // Check SharedPreferences for sensitive data
    try {
      const prefsResult = await driver.execute('mobile: shell', {
        command: 'run-as',
        args: [packageName, 'cat', `shared_prefs/${packageName}_preferences.xml`],
      });

      if (prefsResult) {
        const sensitivePatterns = [
          { pattern: /password/i, label: 'password' },
          { pattern: /token/i, label: 'auth token' },
          { pattern: /api[_-]?key/i, label: 'API key' },
          { pattern: /secret/i, label: 'secret' },
          { pattern: /credit[_-]?card/i, label: 'credit card' },
          { pattern: /ssn/i, label: 'SSN' },
        ];

        for (const { pattern, label } of sensitivePatterns) {
          if (pattern.test(prefsResult)) {
            issues.push({
              type: 'insecure_storage',
              severity: 'high',
              description: `Possible ${label} stored in SharedPreferences without encryption`,
              location: `shared_prefs/${packageName}_preferences.xml`,
              remediation: `Use EncryptedSharedPreferences or Android Keystore for ${label} storage`,
            });
          }
        }
      }
    } catch {
      /* SharedPreferences not accessible or not present */
    }

    // Check for world-readable files
    try {
      const filesResult = await driver.execute('mobile: shell', {
        command: 'run-as',
        args: [packageName, 'ls', '-la', 'shared_prefs/'],
      });

      if (filesResult?.includes('-rw-rw-rw')) {
        issues.push({
          type: 'insecure_permissions',
          severity: 'high',
          description: 'World-readable files found in app storage',
          location: 'shared_prefs/',
          remediation: 'Set file permissions to MODE_PRIVATE',
        });
      }
    } catch {
      /* not accessible */
    }

    // Check for SQLite databases with unencrypted sensitive data
    try {
      const dbResult = await driver.execute('mobile: shell', {
        command: 'run-as',
        args: [packageName, 'ls', 'databases/'],
      });

      if (dbResult) {
        const dbFiles = dbResult.split('\n').filter((f: string) => f.endsWith('.db'));
        for (const db of dbFiles) {
          issues.push({
            type: 'unencrypted_database',
            severity: 'medium',
            description: `SQLite database '${db.trim()}' may contain unencrypted data`,
            location: `databases/${db.trim()}`,
            remediation: 'Use SQLCipher for database encryption',
          });
        }
      }
    } catch {
      /* not accessible */
    }

    return issues;
  }

  private async checkIosStorage(driver: any): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];

    // Check NSUserDefaults via app logs
    try {
      const logs = await driver.getLogs('syslog').catch(() => []);
      const userDefaultsLogs = logs.filter(
        (log: any) => log.message?.includes('NSUserDefaults') || log.message?.includes('UserDefaults'),
      );

      const sensitiveTerms = ['password', 'token', 'secret', 'key', 'credit'];
      for (const log of userDefaultsLogs) {
        for (const term of sensitiveTerms) {
          if (log.message?.toLowerCase().includes(term)) {
            issues.push({
              type: 'insecure_storage',
              severity: 'high',
              description: `Possible sensitive data (${term}) stored in NSUserDefaults`,
              location: 'NSUserDefaults',
              remediation: 'Use iOS Keychain for sensitive data storage',
            });
            break;
          }
        }
      }
    } catch {
      /* logs not accessible */
    }

    return issues;
  }

  private async checkAndroidEncryption(driver: any): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];
    const packageName = await driver.getCurrentPackage().catch(() => 'unknown');

    // Check if app uses Android Keystore
    try {
      const logResult = await driver.execute('mobile: shell', {
        command: 'logcat',
        args: ['-d', '-s', 'KeyStore'],
      });

      if (!logResult || !logResult.includes(packageName)) {
        issues.push({
          type: 'missing_encryption',
          severity: 'medium',
          description: 'No Android Keystore usage detected for encryption',
          location: 'app',
          remediation: 'Use Android Keystore API for cryptographic key management',
        });
      }
    } catch {
      /* not accessible */
    }

    return issues;
  }

  private async checkIosEncryption(driver: any): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];

    try {
      const logs = await driver.getLogs('syslog').catch(() => []);
      const keychainLogs = logs.filter(
        (log: any) => log.message?.includes('SecItem') || log.message?.includes('Keychain'),
      );

      if (keychainLogs.length === 0) {
        issues.push({
          type: 'missing_encryption',
          severity: 'medium',
          description: 'No iOS Keychain usage detected',
          location: 'app',
          remediation: 'Use iOS Keychain Services for sensitive data storage',
        });
      }
    } catch {
      /* not accessible */
    }

    return issues;
  }
}
