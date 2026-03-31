import { Logger } from '../../utils/logger';

export interface PiiInstance {
  type: string;
  value: string;
  location: string;
  severity: 'critical' | 'high' | 'medium';
}

export interface PiiScanResult {
  piiFound: boolean;
  instances: PiiInstance[];
}

const PII_PATTERNS: { type: string; pattern: RegExp; severity: PiiInstance['severity'] }[] = [
  {
    type: 'credit_card',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    severity: 'critical',
  },
  {
    type: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    severity: 'critical',
  },
  {
    type: 'password_in_plaintext',
    pattern: /"(?:password|passwd|pwd)"\s*:\s*"[^"]{3,}"/gi,
    severity: 'critical',
  },
  {
    type: 'api_key',
    pattern: /["'](?:api[_-]?key|apikey|api[_-]?secret|access[_-]?key)["']\s*[:=]\s*["'][a-zA-Z0-9_\-]{16,}["']/gi,
    severity: 'high',
  },
  {
    type: 'bearer_token',
    pattern: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/g,
    severity: 'high',
  },
  {
    type: 'email',
    pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    severity: 'medium',
  },
  {
    type: 'phone_number',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    severity: 'medium',
  },
  {
    type: 'private_key',
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    severity: 'critical',
  },
  {
    type: 'aws_key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: 'critical',
  },
];

export class PiiScanner {
  private logger = new Logger('PiiScanner');

  scanNetworkTraffic(logs: string): PiiScanResult {
    this.logger.log('Scanning network traffic for PII');
    const instances: PiiInstance[] = [];

    for (const { type, pattern, severity } of PII_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(logs)) !== null) {
        const context = this.extractContext(logs, match.index);
        const maskedValue = this.maskValue(match[0], type);

        instances.push({
          type,
          value: maskedValue,
          location: context,
          severity,
        });
      }
    }

    // Deduplicate
    const unique = this.deduplicate(instances);

    if (unique.length > 0) {
      this.logger.warn('PII found in network traffic', { count: unique.length });
    }

    return { piiFound: unique.length > 0, instances: unique };
  }

  scanResponseBody(endpoint: string, responseBody: string): PiiInstance[] {
    const instances: PiiInstance[] = [];

    for (const { type, pattern, severity } of PII_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(responseBody)) !== null) {
        instances.push({
          type,
          value: this.maskValue(match[0], type),
          location: `Response body from ${endpoint}`,
          severity,
        });
      }
    }

    return this.deduplicate(instances);
  }

  private extractContext(logs: string, index: number): string {
    const start = Math.max(0, logs.lastIndexOf('\n', index));
    const end = logs.indexOf('\n', index);
    const line = logs.substring(start, end === -1 ? undefined : end).trim();
    return line.length > 100 ? line.substring(0, 100) + '...' : line;
  }

  private maskValue(value: string, type: string): string {
    if (type === 'credit_card') {
      return value.replace(/\d(?=\d{4})/g, '*');
    }
    if (type === 'ssn') {
      return '***-**-' + value.slice(-4);
    }
    if (type === 'email') {
      const [local, domain] = value.split('@');
      return local[0] + '***@' + domain;
    }
    if (
      type === 'password_in_plaintext' ||
      type === 'api_key' ||
      type === 'bearer_token' ||
      type === 'private_key' ||
      type === 'aws_key'
    ) {
      return value.substring(0, 10) + '***REDACTED***';
    }
    if (value.length > 8) {
      return value.substring(0, 4) + '****' + value.substring(value.length - 4);
    }
    return '****';
  }

  private deduplicate(instances: PiiInstance[]): PiiInstance[] {
    const seen = new Set<string>();
    return instances.filter((i) => {
      const key = `${i.type}:${i.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
