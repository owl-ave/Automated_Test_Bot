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
}

export class FrameworkDetector {
  private logger = new Logger('FrameworkDetector');

  detect(rootPath: string): FrameworkDetection {
    const detections: { detection: FrameworkDetection; score: number }[] = [];

    detections.push({ detection: this.checkReactNative(rootPath), score: 0 });
    detections.push({ detection: this.checkFlutter(rootPath), score: 0 });
    detections.push({ detection: this.checkKotlin(rootPath), score: 0 });
    detections.push({ detection: this.checkSwift(rootPath), score: 0 });

    for (const d of detections) {
      d.score = d.detection.confidence;
    }

    detections.sort((a, b) => b.score - a.score);
    const best = detections[0];

    if (best.score === 0) {
      this.logger.warn('No framework detected, defaulting to native');
      return {
        framework: 'native',
        confidence: 0,
        evidence: [],
        language: 'unknown',
        buildSystem: 'unknown',
      };
    }

    this.logger.log('Framework detected', {
      framework: best.detection.framework,
      subFramework: best.detection.subFramework,
      confidence: best.detection.confidence,
    });

    return best.detection;
  }

  private checkReactNative(rootPath: string): FrameworkDetection {
    const evidence: string[] = [];
    let confidence = 0;
    let subFramework: 'expo' | undefined;

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
      } catch {
        // invalid JSON
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
      } catch {
        // invalid JSON
      }
    }

    const metroConfig = path.join(rootPath, 'metro.config.js');
    if (fs.existsSync(metroConfig)) {
      confidence += 15;
      evidence.push('metro.config.js found');
    }

    if (fs.existsSync(path.join(rootPath, 'android')) && fs.existsSync(path.join(rootPath, 'ios'))) {
      confidence += 10;
      evidence.push('android/ and ios/ directories found');
    }

    return {
      framework: 'react-native',
      subFramework,
      confidence: Math.min(confidence, 100),
      evidence,
      language: 'TypeScript/JavaScript',
      buildSystem: subFramework === 'expo' ? 'expo' : 'metro',
    };
  }

  private checkFlutter(rootPath: string): FrameworkDetection {
    const evidence: string[] = [];
    let confidence = 0;

    const pubspecPath = path.join(rootPath, 'pubspec.yaml');
    if (fs.existsSync(pubspecPath)) {
      const content = fs.readFileSync(pubspecPath, 'utf-8');
      if (content.includes('flutter:')) {
        confidence += 50;
        evidence.push('Flutter SDK in pubspec.yaml');
      }
      if (content.includes('cupertino_icons')) {
        confidence += 5;
        evidence.push('cupertino_icons dependency');
      }
    }

    if (fs.existsSync(path.join(rootPath, 'lib', 'main.dart'))) {
      confidence += 25;
      evidence.push('lib/main.dart entry point found');
    }

    if (fs.existsSync(path.join(rootPath, '.dart_tool')) || fs.existsSync(path.join(rootPath, '.flutter-plugins'))) {
      confidence += 10;
      evidence.push('Flutter tooling files found');
    }

    const androidManifest = path.join(rootPath, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    if (fs.existsSync(androidManifest)) {
      try {
        const content = fs.readFileSync(androidManifest, 'utf-8');
        if (content.includes('FlutterActivity') || content.includes('io.flutter')) {
          confidence += 10;
          evidence.push('FlutterActivity in AndroidManifest.xml');
        }
      } catch {
        // ignore
      }
    }

    return {
      framework: 'flutter',
      confidence: Math.min(confidence, 100),
      evidence,
      language: 'Dart',
      buildSystem: 'flutter',
    };
  }

  private checkKotlin(rootPath: string): FrameworkDetection {
    const evidence: string[] = [];
    let confidence = 0;
    let subFramework: 'jetpack-compose' | 'xml-layouts' | undefined;

    const gradlePaths = [
      path.join(rootPath, 'build.gradle'),
      path.join(rootPath, 'build.gradle.kts'),
      path.join(rootPath, 'app', 'build.gradle'),
      path.join(rootPath, 'app', 'build.gradle.kts'),
    ];

    for (const gradlePath of gradlePaths) {
      if (!fs.existsSync(gradlePath)) continue;
      const content = fs.readFileSync(gradlePath, 'utf-8');

      if (content.includes('kotlin') || content.includes('org.jetbrains.kotlin')) {
        confidence += 30;
        evidence.push(`Kotlin plugin in ${path.basename(gradlePath)}`);
      }
      if (content.includes('com.android.application')) {
        confidence += 20;
        evidence.push('Android application plugin found');
      }
      if (content.includes('compose') || content.includes('androidx.compose')) {
        confidence += 10;
        subFramework = 'jetpack-compose';
        evidence.push('Jetpack Compose dependency detected');
      }
    }

    if (!subFramework) {
      const resLayout = path.join(rootPath, 'app', 'src', 'main', 'res', 'layout');
      if (fs.existsSync(resLayout)) {
        try {
          const xmlFiles = fs.readdirSync(resLayout).filter((f) => f.endsWith('.xml'));
          if (xmlFiles.length > 0) {
            subFramework = 'xml-layouts';
            confidence += 5;
            evidence.push(`${xmlFiles.length} XML layout files found`);
          }
        } catch {
          // ignore
        }
      }
    }

    const srcMain = path.join(rootPath, 'app', 'src', 'main', 'java');
    const srcKotlin = path.join(rootPath, 'app', 'src', 'main', 'kotlin');
    if (fs.existsSync(srcMain) || fs.existsSync(srcKotlin)) {
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
    };
  }

  private checkSwift(rootPath: string): FrameworkDetection {
    const evidence: string[] = [];
    let confidence = 0;
    let subFramework: 'swiftui' | 'storyboard' | undefined;

    const xcodeprojFiles = this.findFiles(rootPath, /\.xcodeproj$/, 2);
    const xcworkspaceFiles = this.findFiles(rootPath, /\.xcworkspace$/, 2);

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

    return {
      framework: 'swift',
      subFramework,
      confidence: Math.min(confidence, 100),
      evidence,
      language: 'Swift',
      buildSystem: 'xcode',
    };
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
          if (stat.isDirectory()) {
            results.push(...this.findFiles(fullPath, pattern, maxDepth, currentDepth + 1));
          } else if (pattern.test(entry)) {
            results.push(fullPath);
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
