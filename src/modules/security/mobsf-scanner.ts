import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import { Logger } from '../../utils/logger';

export interface SecurityIssue {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  location: string;
  remediation: string;
}

export class MobsfScanner {
  private logger = new Logger('MobsfScanner');
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async scan(appPath: string, apiKey: string): Promise<string> {
    this.logger.log('Uploading app to MobSF', { appPath: path.basename(appPath) });

    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(appPath));

      const uploadResponse = await axios.post(`${this.baseUrl}/api/v1/upload`, form, {
        headers: {
          Authorization: apiKey,
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const { hash, scan_type, file_name } = uploadResponse.data;
      this.logger.log('App uploaded, starting scan', { hash, scan_type });

      await axios.post(
        `${this.baseUrl}/api/v1/scan`,
        {
          hash,
          scan_type,
          file_name,
        },
        {
          headers: { Authorization: apiKey },
        },
      );

      return hash;
    } catch (err) {
      this.logger.error('MobSF upload/scan failed', err);
      throw err;
    }
  }

  async getResults(scanId: string, apiKey: string): Promise<SecurityIssue[]> {
    this.logger.log('Fetching MobSF results', { scanId });

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/report_json`,
        {
          hash: scanId,
        },
        {
          headers: { Authorization: apiKey },
        },
      );

      return this.parseResults(response.data);
    } catch (err) {
      this.logger.error('Failed to get MobSF results', err);
      throw err;
    }
  }

  private parseResults(report: any): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    // Code analysis findings
    if (report.code_analysis) {
      for (const [category, findings] of Object.entries(report.code_analysis as Record<string, any>)) {
        if (!findings || typeof findings !== 'object') continue;
        const findingList = Array.isArray(findings) ? findings : [findings];

        for (const finding of findingList) {
          issues.push({
            type: 'code_analysis',
            severity: this.mapSeverity(finding.severity || finding.level || 'info'),
            description: finding.description || finding.title || category,
            location: finding.path || finding.file || 'unknown',
            remediation: finding.remediation || finding.fix || 'Review the flagged code section',
          });
        }
      }
    }

    // Manifest analysis (Android)
    if (report.manifest_analysis) {
      for (const finding of report.manifest_analysis) {
        issues.push({
          type: 'manifest',
          severity: this.mapSeverity(finding.severity || 'medium'),
          description: finding.title || finding.description || 'Manifest issue',
          location: 'AndroidManifest.xml',
          remediation: finding.description || 'Review manifest configuration',
        });
      }
    }

    // Binary analysis
    if (report.binary_analysis) {
      for (const finding of report.binary_analysis) {
        issues.push({
          type: 'binary',
          severity: this.mapSeverity(finding.severity || 'medium'),
          description: finding.description || finding.title || 'Binary issue',
          location: 'binary',
          remediation: finding.remediation || 'Review binary security settings',
        });
      }
    }

    // Certificate analysis
    if (report.certificate_analysis) {
      const cert = report.certificate_analysis;
      if (cert.certificate_findings) {
        for (const finding of cert.certificate_findings) {
          issues.push({
            type: 'certificate',
            severity: this.mapSeverity(finding.severity || 'info'),
            description: finding.description || 'Certificate issue',
            location: 'certificate',
            remediation: finding.remediation || 'Review app signing certificate',
          });
        }
      }
    }

    return issues;
  }

  private mapSeverity(level: string): SecurityIssue['severity'] {
    const normalized = level.toLowerCase();
    if (normalized === 'critical' || normalized === 'danger') return 'critical';
    if (normalized === 'high' || normalized === 'warning') return 'high';
    if (normalized === 'medium') return 'medium';
    if (normalized === 'low') return 'low';
    return 'info';
  }
}
