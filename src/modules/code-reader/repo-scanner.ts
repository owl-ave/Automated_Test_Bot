import * as fs from 'fs';
import * as path from 'path';
import { CodeAnalysis, Screen, ApiEndpoint } from '../../types';
import { Logger } from '../../utils/logger';

export class RepoScanner {
  private logger = new Logger('RepoScanner');
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  scan(): CodeAnalysis {
    const framework = this.detectFramework();
    const screens = this.scanScreens(framework);
    const apiEndpoints = this.scanApiEndpoints();

    this.logger.log('Repo scan complete', {
      framework,
      screenCount: screens.length,
      endpointCount: apiEndpoints.length,
    });

    return {
      framework,
      screens,
      apiEndpoints,
      industry: 'unknown',
      criticalFlows: [],
    };
  }

  private detectFramework(): 'react-native' | 'flutter' | 'swift' | 'kotlin' | 'native' {
    const packageJson = path.join(this.rootPath, 'package.json');
    const pubspecYaml = path.join(this.rootPath, 'pubspec.yaml');
    const buildGradle = path.join(this.rootPath, 'build.gradle');
    const xcodeprojPath = this.findInTree('*.xcodeproj', this.rootPath);

    if (fs.existsSync(packageJson)) {
      const content = fs.readFileSync(packageJson, 'utf-8');
      if (content.includes('react-native')) return 'react-native';
    }
    if (fs.existsSync(pubspecYaml)) return 'flutter';
    if (fs.existsSync(buildGradle)) return 'kotlin';
    if (xcodeprojPath) return 'swift';
    return 'native';
  }

  private scanScreens(framework: string): Screen[] {
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

    if (searchDir && fs.existsSync(path.join(this.rootPath, searchDir))) {
      const files = this.walkDir(path.join(this.rootPath, searchDir));
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
