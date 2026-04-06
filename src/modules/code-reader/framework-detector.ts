import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../utils/logger';

export interface FrameworkDetection {
  framework: 'react-native' | 'flutter' | 'swift' | 'kotlin' | 'native';
  subFramework?: 'jetpack-compose' | 'swiftui' | 'xml-layouts' | 'storyboard' | 'expo';
  confidence: number;
  evidence: string[];
  language: string;
  buildSystem: string;
  mobilePath: string;
}

export class FrameworkDetector {
  private logger = new Logger('FrameworkDetector');

  detect(rootPath: string): FrameworkDetection {
    // Check root + subdirectories up to 2 levels deep
    const dirsToCheck = this.collectDirs(rootPath, 2);

    let bestOverall: { detection: FrameworkDetection; score: number } | null = null;

    for (const dir of dirsToCheck) {
      const detections = [
        this.checkReactNative(dir),
        this.checkFlutter(dir),
        this.checkKotlin(dir),
        this.checkSwift(dir),
      ];

      for (const detection of detections) {
        if (!bestOverall || detection.confidence > bestOverall.score) {
          bestOverall = { detection, score: detection.confidence };
        }
      }

      // Early exit if we have high confidence
      if (bestOverall && bestOverall.score >= 80) break;
    }

    if (!bestOverall || bestOverall.score === 0) {
      this.logger.warn('No framework detected in any directory, defaulting to native');
      return {
        framework: 'native',
        confidence: 0,
        evidence: [],
        language: 'unknown',
        buildSystem: 'unknown',
        mobilePath: rootPath,
      };
    }

    this.logger.log('Framework detected', {
      framework: bestOverall.detection.framework,
      subFramework: bestOverall.detection.subFramework,
      confidence: bestOverall.detection.confidence,
      mobilePath: bestOverall.detection.mobilePath,
    });

    return bestOverall.detection;
  }

  private checkReactNative(dirPath: string): FrameworkDetection {
    const evidence: string[] = [];
    let confidence = 0;
    let subFramework: 'expo' | undefined;
    const rootPath = dirPath;

    const packageJsonPath = path.join(rootPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (allDeps['react-native']) {
          confidence += 40;
          evidence.push(`react-native@${allDeps['react-native']} in package.json`);
        }
        if (allDeps['expo']) {
          confidence += 10;
          subFramework = 'expo';
          evidence.push('Expo framework detected');
        }
        if (allDeps['@react-navigation/native']) {
          confidence += 10;
          evidence.push('React Navigation detected');
        }
        if (allDeps['react-native-screens']) {
          confidence += 5;
          evidence.push('react-native-screens detected');
        }
      } catch (e) {
        this.logger.warn('Failed to parse package.json', { path: packageJsonPath, error: String(e) });
      }
    }

    const appJsonPath = path.join(rootPath, 'app.json');
    if (fs.existsSync(appJsonPath)) {
      try {
        const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
        if (appJson.expo || appJson.name) {
          confidence += 10;
          evidence.push('app.json found');
        }
      } catch (e) {
        this.logger.warn('Failed to parse app.json', { path: appJsonPath, error: String(e) });
      }
    }

    const metroConfig = path.join(rootPath, 'metro.config.js');
    if (fs.existsSync(metroConfig)) {
      confidence += 15;
      evidence.push('metro.config.js found');
    }

    // B10/B12: Award points if EITHER android OR ios folder exists (not both required)
    const hasAndroidDir = fs.existsSync(path.join(rootPath, 'android'));
    const hasIosDir = fs.existsSync(path.join(rootPath, 'ios'));
    if (hasAndroidDir && hasIosDir) {
      confidence += 10;
      evidence.push('android/ and ios/ directories found');
    } else if (hasAndroidDir || hasIosDir) {
      confidence += 5;
      evidence.push(`${hasAndroidDir ? 'android/' : 'ios/'} directory found`);
    }

    return {
      framework: 'react-native',
      subFramework,
      confidence: Math.min(confidence, 100),
      evidence,
      language: 'TypeScript/JavaScript',
      buildSystem: subFramework === 'expo' ? 'expo' : 'metro',
      mobilePath: dirPath,
    };
  }

  private checkFlutter(rootPath: string): FrameworkDetection {
    const evidence: string[] = [];
    let confidence = 0;
    let flutterMobilePath = rootPath;

    // B7/B8: Check rootPath AND immediate subdirs for pubspec.yaml
    const pubspecCandidates = [path.join(rootPath, 'pubspec.yaml')];
    try {
      for (const entry of fs.readdirSync(rootPath)) {
        const sub = path.join(rootPath, entry);
        try {
          if (fs.statSync(sub).isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
            pubspecCandidates.push(path.join(sub, 'pubspec.yaml'));
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    for (const pubspecPath of pubspecCandidates) {
      if (!fs.existsSync(pubspecPath)) continue;
      try {
        const content = fs.readFileSync(pubspecPath, 'utf-8');
        if (content.includes('flutter:')) {
          confidence += 50;
          evidence.push(`Flutter SDK in ${path.relative(rootPath, pubspecPath)}`);
          flutterMobilePath = path.dirname(pubspecPath);
        }
        if (content.includes('cupertino_icons')) {
          confidence += 5;
          evidence.push('cupertino_icons dependency');
        }
      } catch { /* ignore */ }
    }

    const mobileRoot = flutterMobilePath;
    if (fs.existsSync(path.join(mobileRoot, 'lib', 'main.dart'))) {
      confidence += 25;
      evidence.push('lib/main.dart entry point found');
    } else {
      // B7: any main.dart inside lib/ counts
      const libDir = path.join(mobileRoot, 'lib');
      if (fs.existsSync(libDir)) {
        try {
          const dartFiles = fs.readdirSync(libDir);
          if (dartFiles.some((f) => f.endsWith('.dart'))) {
            confidence += 10;
            evidence.push('Dart files found in lib/');
          }
        } catch { /* ignore */ }
      }
    }

    if (fs.existsSync(path.join(mobileRoot, '.dart_tool')) || fs.existsSync(path.join(mobileRoot, '.flutter-plugins'))) {
      confidence += 10;
      evidence.push('Flutter tooling files found');
    }

    const androidManifest = path.join(mobileRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    if (fs.existsSync(androidManifest)) {
      try {
        const content = fs.readFileSync(androidManifest, 'utf-8');
        if (content.includes('FlutterActivity') || content.includes('io.flutter')) {
          confidence += 10;
          evidence.push('FlutterActivity in AndroidManifest.xml');
        }
      } catch { /* ignore */ }
    }

    return {
      framework: 'flutter',
      confidence: Math.min(confidence, 100),
      evidence,
      language: 'Dart',
      buildSystem: 'flutter',
      mobilePath: flutterMobilePath,
    };
  }

  private checkKotlin(rootPath: string): FrameworkDetection {
    const evidence: string[] = [];
    let confidence = 0;
    let subFramework: 'jetpack-compose' | 'xml-layouts' | undefined;
    let kotlinMobilePath = rootPath;

    // B4: Check root, app/, and all immediate subdirs for build.gradle
    const gradleSearchDirs = [rootPath];
    try {
      for (const entry of fs.readdirSync(rootPath)) {
        const sub = path.join(rootPath, entry);
        try {
          if (fs.statSync(sub).isDirectory() && !entry.startsWith('.') && entry !== 'node_modules' && entry !== 'build') {
            gradleSearchDirs.push(sub);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    for (const searchDir of gradleSearchDirs) {
      const gradlePaths = [
        path.join(searchDir, 'build.gradle'),
        path.join(searchDir, 'build.gradle.kts'),
        path.join(searchDir, 'app', 'build.gradle'),
        path.join(searchDir, 'app', 'build.gradle.kts'),
      ];

      for (const gradlePath of gradlePaths) {
        if (!fs.existsSync(gradlePath)) continue;
        try {
          const content = fs.readFileSync(gradlePath, 'utf-8');
          if (content.includes('kotlin') || content.includes('org.jetbrains.kotlin')) {
            confidence += 30;
            evidence.push(`Kotlin plugin in ${path.relative(rootPath, gradlePath)}`);
            kotlinMobilePath = searchDir;
          }
          if (content.includes('com.android.application')) {
            confidence += 20;
            evidence.push('Android application plugin found');
            kotlinMobilePath = searchDir;
          }
          if (content.includes('compose') || content.includes('androidx.compose')) {
            confidence += 10;
            subFramework = 'jetpack-compose';
            evidence.push('Jetpack Compose dependency detected');
          }
        } catch { /* ignore */ }
      }
      if (confidence >= 50) break; // found a strong match, stop searching subdirs
    }

    // B5: Also check for gradlew in any subdir as a strong Android signal
    if (confidence === 0) {
      const gradlewDirs = gradleSearchDirs.filter((d) =>
        fs.existsSync(path.join(d, 'gradlew')) || fs.existsSync(path.join(d, 'android', 'gradlew')),
      );
      if (gradlewDirs.length > 0) {
        confidence += 20;
        evidence.push('gradlew found — Android project detected');
        kotlinMobilePath = gradlewDirs[0];
      }
    }

    if (!subFramework) {
      // Check app/src/main/res/layout AND any subdir equivalent
      for (const searchDir of [kotlinMobilePath, rootPath]) {
        const resLayout = path.join(searchDir, 'app', 'src', 'main', 'res', 'layout');
        if (fs.existsSync(resLayout)) {
          try {
            const xmlFiles = fs.readdirSync(resLayout).filter((f) => f.endsWith('.xml'));
            if (xmlFiles.length > 0) {
              subFramework = 'xml-layouts';
              confidence += 5;
              evidence.push(`${xmlFiles.length} XML layout files found`);
              break;
            }
          } catch { /* ignore */ }
        }
      }
    }

    // B11: Check multiple possible source dirs
    const srcDirCandidates = [
      path.join(kotlinMobilePath, 'app', 'src', 'main', 'java'),
      path.join(kotlinMobilePath, 'app', 'src', 'main', 'kotlin'),
      path.join(kotlinMobilePath, 'src', 'main', 'java'),
      path.join(kotlinMobilePath, 'src', 'main', 'kotlin'),
    ];
    if (srcDirCandidates.some((d) => fs.existsSync(d))) {
      confidence += 10;
      evidence.push('Android source directories found');
    }

    return {
      framework: 'kotlin',
      subFramework,
      confidence: Math.min(confidence, 100),
      evidence,
      language: 'Kotlin',
      buildSystem: 'gradle',
      mobilePath: kotlinMobilePath,
    };
  }

  private checkSwift(rootPath: string): FrameworkDetection {
    const evidence: string[] = [];
    let confidence = 0;
    let subFramework: 'swiftui' | 'storyboard' | undefined;

    // B3: search 3 levels deep — xcodeproj can be at root, ios/, or a named subfolder
    const xcodeprojFiles = this.findFiles(rootPath, /\.xcodeproj$/, 3);
    const xcworkspaceFiles = this.findFiles(rootPath, /\.xcworkspace$/, 3);

    if (xcodeprojFiles.length > 0) {
      confidence += 30;
      evidence.push(`Xcode project found: ${path.basename(xcodeprojFiles[0])}`);
    }
    if (xcworkspaceFiles.length > 0) {
      confidence += 10;
      evidence.push('Xcode workspace found');
    }

    const podfilePath = path.join(rootPath, 'Podfile');
    if (fs.existsSync(podfilePath)) {
      confidence += 15;
      evidence.push('Podfile found (CocoaPods)');
    }

    const packageSwift = path.join(rootPath, 'Package.swift');
    if (fs.existsSync(packageSwift)) {
      confidence += 10;
      evidence.push('Package.swift found (SPM)');
    }

    const swiftFiles = this.findFiles(rootPath, /\.swift$/, 3);
    if (swiftFiles.length > 0) {
      confidence += 10;
      evidence.push(`${swiftFiles.length} Swift files found`);

      for (const file of swiftFiles.slice(0, 20)) {
        try {
          const content = fs.readFileSync(file, 'utf-8');
          if (content.includes('SwiftUI') || (content.includes('struct') && content.includes(': View'))) {
            subFramework = 'swiftui';
            evidence.push('SwiftUI usage detected');
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    if (!subFramework) {
      const storyboards = this.findFiles(rootPath, /\.storyboard$/, 3);
      if (storyboards.length > 0) {
        subFramework = 'storyboard';
        confidence += 5;
        evidence.push(`${storyboards.length} storyboard files found`);
      }
    }

    // G4: mobilePath = dir where Xcode project lives, not necessarily rootPath.
    // Exclude project.xcworkspace — it lives *inside* the .xcodeproj bundle and is not a standalone workspace.
    const standaloneWorkspaces = xcworkspaceFiles.filter((f) => !f.includes('.xcodeproj/'));
    const xcodeFile = standaloneWorkspaces[0] || xcodeprojFiles[0];
    const swiftMobilePath = xcodeFile ? path.dirname(xcodeFile) : rootPath;

    return {
      framework: 'swift',
      subFramework,
      confidence: Math.min(confidence, 100),
      evidence,
      language: 'Swift',
      buildSystem: 'xcode',
      mobilePath: swiftMobilePath,
    };
  }

  /**
   * Detect framework from PR diff file paths — used as fallback when filesystem scan returns nothing.
   * Handles cases where the target repo is a new iOS/Android project being added from scratch.
   */
  detectFromFilePaths(filePaths: string[], rootPath: string): FrameworkDetection | null {
    let swiftScore = 0, kotlinScore = 0, flutterScore = 0;
    let swiftMobilePath = rootPath;

    for (const p of filePaths) {
      const basename = path.basename(p);
      const lower = p.toLowerCase();

      // .xcodeproj match (may be a path segment like ios/Nola.xcodeproj/project.pbxproj)
      const xcodeprojMatch = p.match(/^(.*?\.xcodeproj)(\/|$)/i);
      if (xcodeprojMatch) {
        swiftScore += 30;
        // mobilePath = directory containing the .xcodeproj bundle
        swiftMobilePath = path.join(rootPath, path.dirname(xcodeprojMatch[1]));
      } else if (/\.xcworkspace(\/|$)/i.test(p)) {
        swiftScore += 10;
      } else if (lower.endsWith('.swift')) {
        swiftScore = Math.max(swiftScore, 1) + 5; // cap contribution
      } else if (lower.endsWith('.storyboard') || lower.endsWith('.xib')) {
        swiftScore += 3;
      } else if (basename === 'Podfile') {
        swiftScore += 15;
      } else if (basename === 'build.gradle' || basename === 'build.gradle.kts') {
        kotlinScore += 30;
      } else if (lower.endsWith('.kt') || lower.endsWith('.kts')) {
        kotlinScore += 5;
      } else if (basename === 'gradlew') {
        kotlinScore += 20;
      } else if (basename === 'pubspec.yaml') {
        flutterScore += 50;
      } else if (lower.endsWith('.dart')) {
        flutterScore += 10;
      }
    }

    const candidates = [
      { framework: 'swift' as const, score: swiftScore, mobilePath: swiftMobilePath, language: 'Swift', buildSystem: 'xcode' },
      { framework: 'kotlin' as const, score: kotlinScore, mobilePath: rootPath, language: 'Kotlin', buildSystem: 'gradle' },
      { framework: 'flutter' as const, score: flutterScore, mobilePath: rootPath, language: 'Dart', buildSystem: 'flutter' },
    ];

    const best = candidates.reduce((a, b) => (a.score > b.score ? a : b));
    if (best.score === 0) return null;

    this.logger.log('Framework detected from diff file paths', { framework: best.framework, confidence: best.score });

    return {
      framework: best.framework,
      confidence: Math.min(best.score, 100),
      evidence: [`Detected from ${filePaths.length} PR diff file paths`],
      language: best.language,
      buildSystem: best.buildSystem,
      mobilePath: best.mobilePath,
    };
  }

  private collectDirs(rootDir: string, maxDepth: number): string[] {
    const skipDirs = new Set(['.', 'node_modules', 'build', 'dist', 'Pods', '.git']);
    const dirs = [rootDir];

    const scan = (dir: string, depth: number) => {
      if (depth >= maxDepth) return;
      try {
        for (const entry of fs.readdirSync(dir)) {
          if (entry.startsWith('.') || skipDirs.has(entry)) continue;
          const fullPath = path.join(dir, entry);
          try {
            if (fs.statSync(fullPath).isDirectory()) {
              dirs.push(fullPath);
              scan(fullPath, depth + 1);
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    };

    scan(rootDir, 0);
    return dirs;
  }

  private findFiles(dir: string, pattern: RegExp, maxDepth: number, currentDepth = 0): string[] {
    if (currentDepth >= maxDepth) return [];
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (
          entry.startsWith('.') ||
          entry === 'node_modules' ||
          entry === 'build' ||
          entry === 'dist' ||
          entry === 'Pods'
        )
          continue;
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          // Check pattern first — .xcodeproj and .xcworkspace are directories on macOS
          // but should be matched as files, not recursed into
          if (pattern.test(entry)) {
            results.push(fullPath);
          } else if (stat.isDirectory()) {
            results.push(...this.findFiles(fullPath, pattern, maxDepth, currentDepth + 1));
          }
        } catch {
          // ignore permission errors
        }
      }
    } catch {
      // ignore
    }
    return results;
  }
}
