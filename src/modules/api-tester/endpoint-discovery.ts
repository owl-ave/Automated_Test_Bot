import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../utils/logger';
import { ApiEndpoint } from '../../types';

interface DiscoveredEndpoint extends ApiEndpoint {
  sourceFile: string;
  headers?: Record<string, string>;
}

// Patterns for HTTP library calls across mobile frameworks
const PATTERNS: Record<string, RegExp[]> = {
  retrofit: [/@(GET|POST|PUT|DELETE|PATCH)\s*\(\s*["']([^"']+)["']\s*\)/g],
  alamofire: [
    /AF\.(request|get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g,
    /session\.(request|get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g,
  ],
  dio: [/dio\.(get|post|put|delete|patch)\s*[(<]\s*["']([^"']+)["']/g],
  fetch: [/fetch\s*\(\s*[`"']([^`"']*)[`"']\s*(?:,\s*\{[^}]*method\s*:\s*["'](\w+)["'])?/g],
  axios: [
    /axios\.(get|post|put|delete|patch)\s*[(<]\s*["'`]([^"'`]+)["'`]/g,
    /axios\s*\(\s*\{[^}]*url\s*:\s*["'`]([^"'`]+)["'`][^}]*method\s*:\s*["'](\w+)["']/g,
  ],
};

export class EndpointDiscovery {
  private logger = new Logger('EndpointDiscovery');

  async discoverEndpoints(rootPath: string, framework: string): Promise<DiscoveredEndpoint[]> {
    this.logger.log('Discovering API endpoints', { rootPath, framework });

    const extensions = this.getExtensions(framework);
    const files = this.findSourceFiles(rootPath, extensions);
    const endpoints: DiscoveredEndpoint[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const discovered = this.extractEndpoints(content, file, framework);
        endpoints.push(...discovered);
      } catch (err) {
        this.logger.error(`Failed to scan file: ${file}`, err);
      }
    }

    const unique = this.deduplicateEndpoints(endpoints);
    this.logger.log('Endpoint discovery complete', { total: unique.length });
    return unique;
  }

  private getExtensions(framework: string): string[] {
    switch (framework) {
      case 'kotlin':
        return ['.kt', '.java'];
      case 'swift':
        return ['.swift'];
      case 'flutter':
        return ['.dart'];
      case 'react-native':
        return ['.ts', '.tsx', '.js', '.jsx'];
      default:
        return ['.ts', '.tsx', '.js', '.jsx', '.kt', '.java', '.swift', '.dart'];
    }
  }

  private findSourceFiles(rootPath: string, extensions: string[]): string[] {
    const results: string[] = [];
    const ignoreDirs = new Set(['node_modules', '.git', 'build', 'dist', 'ios/Pods', 'android/.gradle']);

    const walk = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!ignoreDirs.has(entry.name)) {
              walk(path.join(dir, entry.name));
            }
          } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
            results.push(path.join(dir, entry.name));
          }
        }
      } catch {
        /* skip inaccessible dirs */
      }
    };

    walk(rootPath);
    return results;
  }

  private extractEndpoints(content: string, filePath: string, framework: string): DiscoveredEndpoint[] {
    const endpoints: DiscoveredEndpoint[] = [];
    const patternSets = this.getPatternsForFramework(framework);

    for (const patterns of patternSets) {
      for (const pattern of patterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
          const endpoint = this.parseMatch(match, filePath);
          if (endpoint) {
            endpoints.push(endpoint);
          }
        }
      }
    }

    return endpoints;
  }

  private getPatternsForFramework(framework: string): RegExp[][] {
    switch (framework) {
      case 'kotlin':
        return [PATTERNS.retrofit, PATTERNS.axios];
      case 'swift':
        return [PATTERNS.alamofire, PATTERNS.fetch];
      case 'flutter':
        return [PATTERNS.dio];
      case 'react-native':
        return [PATTERNS.fetch, PATTERNS.axios];
      default:
        return Object.values(PATTERNS);
    }
  }

  private parseMatch(match: RegExpExecArray, filePath: string): DiscoveredEndpoint | null {
    if (!match[1] && !match[2]) return null;

    let method: string;
    let urlPath: string;

    if (match[2] && /^(GET|POST|PUT|DELETE|PATCH)$/i.test(match[1])) {
      method = match[1].toUpperCase();
      urlPath = match[2];
    } else if (match[2] && /^(get|post|put|delete|patch|request)$/i.test(match[1])) {
      method = match[1] === 'request' ? 'GET' : match[1].toUpperCase();
      urlPath = match[2];
    } else {
      urlPath = match[1];
      method = match[2]?.toUpperCase() || 'GET';
    }

    // Skip non-URL strings
    if (!urlPath || urlPath.length < 2) return null;

    return {
      method,
      path: urlPath,
      sourceFile: filePath,
    };
  }

  private deduplicateEndpoints(endpoints: DiscoveredEndpoint[]): DiscoveredEndpoint[] {
    const seen = new Set<string>();
    return endpoints.filter((ep) => {
      const key = `${ep.method}:${ep.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
