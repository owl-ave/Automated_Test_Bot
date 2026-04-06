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

  scan(diffFilePaths?: string[]): CodeAnalysis & { mobilePath: string } {
    const detector = new FrameworkDetector();
    let detection = detector.detect(this.rootPath);

    // Fallback: if filesystem scan found nothing, detect from PR diff file paths.
    // This handles repos being bootstrapped from scratch (all files are "added").
    if (detection.framework === 'native' && diffFilePaths && diffFilePaths.length > 0) {
      const fallback = detector.detectFromFilePaths(diffFilePaths, this.rootPath);
      if (fallback) {
        this.logger.log('Filesystem scan returned native/unknown — using diff-path detection', {
          framework: fallback.framework,
          mobilePath: fallback.mobilePath,
        });
        detection = fallback;
      }
    }

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

    // Detect minimum OS versions from project files
    const minIosVersion = this.detectMinIosVersion(mobilePath);
    const minAndroidVersion = this.detectMinAndroidVersion(mobilePath);

    return {
      framework,
      screens,
      apiEndpoints,
      industry: 'unknown',
      criticalFlows: [],
      mobilePath,
      minIosVersion,
      minAndroidVersion,
    };
  }

  private scanScreens(framework: string, mobilePath: string): Screen[] {
    if (framework === 'swift') return this.scanSwiftScreens(mobilePath);
    if (framework === 'kotlin') return this.scanKotlinScreens(mobilePath);

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

  private scanSwiftScreens(mobilePath: string): Screen[] {
    const screens: Screen[] = [];
    const files = this.walkDir(mobilePath).filter((f) => f.endsWith('.swift'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const name = path.basename(file, '.swift');

        if (content.includes('UIViewController') || content.includes('UITableViewController') || content.includes('UICollectionViewController')) {
          screens.push({ name, path: file, type: 'viewcontroller', elements: [] });
        } else if ((content.includes('import SwiftUI') || content.includes('SwiftUI')) && /struct\s+\w+\s*:\s*View/.test(content)) {
          screens.push({ name, path: file, type: 'swiftui-view', elements: [] });
        }
      } catch { /* ignore unreadable files */ }
    }

    return screens;
  }

  private scanKotlinScreens(mobilePath: string): Screen[] {
    const screens: Screen[] = [];
    const searchDirs = [
      path.join(mobilePath, 'app', 'src', 'main', 'java'),
      path.join(mobilePath, 'app', 'src', 'main', 'kotlin'),
      mobilePath,
    ];

    const seen = new Set<string>();
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = this.walkDir(dir).filter((f) => f.endsWith('.kt'));

      for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        try {
          const content = fs.readFileSync(file, 'utf-8');
          const name = path.basename(file, '.kt');

          if (/:\s*(AppCompat)?Activity\b/.test(content) || /:\s*ComponentActivity\b/.test(content)) {
            screens.push({ name, path: file, type: 'activity', elements: [] });
          } else if (/:\s*Fragment\b/.test(content)) {
            screens.push({ name, path: file, type: 'fragment', elements: [] });
          } else if (content.includes('@Composable')) {
            screens.push({ name, path: file, type: 'composable', elements: [] });
          }
        } catch { /* ignore unreadable files */ }
      }
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
          if (!file.includes('node_modules') && !file.startsWith('.') && !file.includes('dist')) {
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

  private detectMinIosVersion(mobilePath: string): string | undefined {
    // Check pbxproj for IPHONEOS_DEPLOYMENT_TARGET
    const pbxproj = this.findInTree('project\\.pbxproj$', mobilePath);
    if (pbxproj) {
      try {
        const content = fs.readFileSync(pbxproj, 'utf-8');
        const match = content.match(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*([\d.]+)/);
        if (match) return match[1];
      } catch { /* ignore */ }
    }
    return undefined;
  }

  private detectMinAndroidVersion(mobilePath: string): string | undefined {
    // Check build.gradle for minSdkVersion
    const gradle = this.findInTree('build\\.gradle(\\.kts)?$', mobilePath);
    if (gradle) {
      try {
        const content = fs.readFileSync(gradle, 'utf-8');
        const match = content.match(/minSdk(?:Version)?\s*[=:]\s*(\d+)/);
        if (match) return match[1];
      } catch { /* ignore */ }
    }
    return undefined;
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
