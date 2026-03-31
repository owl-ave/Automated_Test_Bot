import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

type BuildSystem = 'gradle' | 'xcodebuild' | 'react-native' | 'flutter';

const logger = new Logger('AppBuilder');

export function detectBuildSystem(rootPath: string): BuildSystem {
  if (fs.existsSync(path.join(rootPath, 'pubspec.yaml'))) {
    logger.log('Detected Flutter project');
    return 'flutter';
  }

  if (fs.existsSync(path.join(rootPath, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['react-native'] || deps['@react-native-community/cli']) {
        logger.log('Detected React Native project');
        return 'react-native';
      }
    } catch {
      // not a valid package.json
    }
  }

  if (
    fs.existsSync(path.join(rootPath, 'build.gradle')) ||
    fs.existsSync(path.join(rootPath, 'build.gradle.kts')) ||
    fs.existsSync(path.join(rootPath, 'app', 'build.gradle')) ||
    fs.existsSync(path.join(rootPath, 'app', 'build.gradle.kts'))
  ) {
    logger.log('Detected Gradle (Android) project');
    return 'gradle';
  }

  // Check for Xcode project files
  const entries = fs.existsSync(rootPath) ? fs.readdirSync(rootPath) : [];
  if (entries.some((e) => e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace'))) {
    logger.log('Detected Xcode (iOS) project');
    return 'xcodebuild';
  }

  logger.warn('Could not detect build system, defaulting to gradle');
  return 'gradle';
}

export function getAppVersion(rootPath: string, framework: string): string {
  try {
    switch (framework) {
      case 'flutter':
        return parseFlutterVersion(rootPath);
      case 'react-native':
        return parseReactNativeVersion(rootPath);
      case 'gradle':
        return parseGradleVersion(rootPath);
      case 'xcodebuild':
        return parseXcodeVersion(rootPath);
      default:
        return '0.0.0';
    }
  } catch (err) {
    logger.warn(`Failed to parse app version for ${framework}`, err);
    return '0.0.0';
  }
}

export function getBuildNumber(rootPath: string, framework: string): string {
  try {
    switch (framework) {
      case 'flutter': {
        const pubspec = fs.readFileSync(path.join(rootPath, 'pubspec.yaml'), 'utf-8');
        const match = pubspec.match(/version:\s*[\d.]+\+(\d+)/);
        return match?.[1] ?? '1';
      }
      case 'react-native': {
        const gradlePath = findGradleFile(rootPath, 'android/app');
        if (gradlePath) {
          const content = fs.readFileSync(gradlePath, 'utf-8');
          const match = content.match(/versionCode\s+(\d+)/);
          return match?.[1] ?? '1';
        }
        return '1';
      }
      case 'gradle': {
        const gradlePath = findGradleFile(rootPath, 'app');
        if (gradlePath) {
          const content = fs.readFileSync(gradlePath, 'utf-8');
          const match = content.match(/versionCode\s+(\d+)/);
          return match?.[1] ?? '1';
        }
        return '1';
      }
      case 'xcodebuild': {
        const plistPath = findInfoPlist(rootPath);
        if (plistPath) {
          const content = fs.readFileSync(plistPath, 'utf-8');
          const match = content.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/);
          return match?.[1] ?? '1';
        }
        return '1';
      }
      default:
        return '1';
    }
  } catch (err) {
    logger.warn(`Failed to parse build number for ${framework}`, err);
    return '1';
  }
}

function parseFlutterVersion(rootPath: string): string {
  const pubspec = fs.readFileSync(path.join(rootPath, 'pubspec.yaml'), 'utf-8');
  const match = pubspec.match(/version:\s*([\d.]+)/);
  return match?.[1] ?? '0.0.0';
}

function parseReactNativeVersion(rootPath: string): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8'));
  return pkg.version ?? '0.0.0';
}

function parseGradleVersion(rootPath: string): string {
  const gradlePath = findGradleFile(rootPath, 'app');
  if (!gradlePath) return '0.0.0';
  const content = fs.readFileSync(gradlePath, 'utf-8');
  const match = content.match(/versionName\s+["']([^"']+)["']/);
  return match?.[1] ?? '0.0.0';
}

function parseXcodeVersion(rootPath: string): string {
  const plistPath = findInfoPlist(rootPath);
  if (!plistPath) return '0.0.0';
  const content = fs.readFileSync(plistPath, 'utf-8');
  const match = content.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
  return match?.[1] ?? '0.0.0';
}

function findGradleFile(rootPath: string, subdir: string): string | null {
  const candidates = [
    path.join(rootPath, subdir, 'build.gradle.kts'),
    path.join(rootPath, subdir, 'build.gradle'),
    path.join(rootPath, 'build.gradle.kts'),
    path.join(rootPath, 'build.gradle'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function findInfoPlist(rootPath: string): string | null {
  const candidates = [
    path.join(rootPath, 'ios', 'Runner', 'Info.plist'),
    path.join(rootPath, 'ios', 'App', 'Info.plist'),
  ];

  // Also check direct subdirectories for .xcodeproj sibling Info.plist
  if (fs.existsSync(path.join(rootPath, 'ios'))) {
    const iosEntries = fs.readdirSync(path.join(rootPath, 'ios'));
    for (const entry of iosEntries) {
      const plist = path.join(rootPath, 'ios', entry, 'Info.plist');
      if (fs.existsSync(plist)) candidates.push(plist);
    }
  }

  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
