import * as fs from 'fs';
import * as path from 'path';
import { CodeAnalysis, Screen, ApiEndpoint } from '../../types';
import { FrameworkDetector } from './framework-detector';
import { Logger } from '../../utils/logger';

export class RepoScanner {
  private logger = new Logger('RepoScanner');
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  scan(): CodeAnalysis & { mobilePath: string } {
    const detector = new FrameworkDetector();
    const detection = detector.detect(this.rootPath);
    const framework = detection.framework;
    const mobilePath = detection.mobilePath;
    const screens = this.scanScreens(framework, mobilePath);
    const apiEndpoints = this.scanApiEndpoints();

    this.logger.log('Repo scan complete', {
      framework,
      mobilePath,
      screenCount: screens.length,
      endpointCount: apiEndpoints.length,
    });

    return {
      framework,
      screens,
      apiEndpoints,
      industry: 'unknown',
      criticalFlows: [],
      mobilePath,
    };
  }

  private scanScreens(framework: string, mobilePath: string): Screen[] {
    const screens: Screen[] = [];
    let searchDir = '';
    let fileExt = '';

    if (framework === 'react-native') {
      searchDir = 'src/screens';
      fileExt = '.tsx';
    } else if (framework === 'flutter') {
      searchDir = 'lib/screens';
      fileExt = '.dart';
    }

    if (searchDir && fs.existsSync(path.join(mobilePath, searchDir))) {
      const files = this.walkDir(path.join(mobilePath, searchDir));
      files.forEach((file) => {
        if (file.endsWith(fileExt)) {
          screens.push({
            name: path.basename(file, fileExt),
            path: file,
            type: 'screen',
            elements: [],
          });
        }
      });
    }

    return screens;
  }

  private scanApiEndpoints(): ApiEndpoint[] {
    const endpoints: ApiEndpoint[] = [];
    const apiFiles = this.walkDir(this.rootPath).filter((f) => f.includes('api') || f.includes('service'));

    apiFiles.forEach((file) => {
      if (
        !file.endsWith('.ts') &&
        !file.endsWith('.tsx') &&
        !file.endsWith('.dart') &&
        !file.endsWith('.swift') &&
        !file.endsWith('.kt')
      )
        return;
      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.match(/(?:get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi);
      if (matches) {
        matches.forEach((match) => {
          const method = match.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || 'GET';
          const path = match.match(/['"]([^'"]+)['"]/)?.[1] || '';
          endpoints.push({ method, path });
        });
      }
    });

    return endpoints;
  }

  private walkDir(dir: string): string[] {
    const files: string[] = [];
    try {
      fs.readdirSync(dir).forEach((file) => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          if (!file.includes('node_modules') && !file.includes('.') && !file.includes('dist')) {
            files.push(...this.walkDir(fullPath));
          }
        } else {
          files.push(fullPath);
        }
      });
    } catch {
      // ignore
    }
    return files;
  }

  private findInTree(pattern: string, dir: string): string | null {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.match(pattern)) return path.join(dir, file);
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory() && !file.includes('node_modules')) {
          const found = this.findInTree(pattern, fullPath);
          if (found) return found;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }
}
