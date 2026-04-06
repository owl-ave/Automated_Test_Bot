import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Logger } from '../../utils/logger';

export class AndroidBuilder {
  private logger = new Logger('AndroidBuilder');
  private rootPath: string;
  private contextFramework: string | undefined;

  constructor(rootPath: string, contextFramework?: string) {
    this.rootPath = rootPath;
    this.contextFramework = contextFramework;
  }

  async build(): Promise<string> {
    // G1: Use framework from pipeline context first, fall back to local detection
    const framework = this.contextFramework || this.detectFramework();

    if (framework === 'react-native') {
      return this.buildReactNative();
    } else if (framework === 'flutter') {
      return this.buildFlutter();
    } else {
      return this.buildNativeAndroid();
    }
  }

  private detectFramework(): 'react-native' | 'flutter' | 'native' {
    const packageJson = path.join(this.rootPath, 'package.json');
    const pubspecYaml = path.join(this.rootPath, 'pubspec.yaml');

    if (fs.existsSync(packageJson)) {
      try {
        const content = fs.readFileSync(packageJson, 'utf-8');
        if (content.includes('react-native')) return 'react-native';
      } catch { /* ignore */ }
    }
    if (fs.existsSync(pubspecYaml)) return 'flutter';
    return 'native';
  }

  private buildReactNative(): string {
    try {
      this.logger.log('Building React Native APK');

      // Install JS dependencies — detect yarn vs npm
      if (!fs.existsSync(path.join(this.rootPath, 'node_modules'))) {
        const useYarn = fs.existsSync(path.join(this.rootPath, 'yarn.lock'));
        const installCmd = useYarn ? 'yarn install --frozen-lockfile' : 'npm install';
        this.logger.log('Installing React Native dependencies', { packageManager: useYarn ? 'yarn' : 'npm' });
        execSync(installCmd, { cwd: this.rootPath, stdio: 'inherit', timeout: 300000 });
      }

      // B5: Find android dir dynamically — it might not be named "android/"
      const androidDir = this.findAndroidDir();
      if (!androidDir) throw new Error('Android project directory not found (no gradlew in any subdir)');

      const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

      if (process.platform !== 'win32' && fs.existsSync(path.join(androidDir, 'gradlew'))) {
        execSync('chmod +x gradlew', { cwd: androidDir });
      }

      // Use assembleDebug — no keystore needed, works on any app out of the box
      execSync(`${gradlew} assembleDebug`, {
        cwd: androidDir,
        stdio: 'inherit',
        env: { ...process.env },
        timeout: 600000,
      });

      const apkPath = this.findApk();
      if (!apkPath) throw new Error('APK not found after build');

      this.logger.log('React Native APK built', { apkPath });
      return apkPath;
    } catch (error) {
      this.logger.error('React Native build failed', error);
      throw error;
    }
  }

  private buildFlutter(): string {
    try {
      this.logger.log('Building Flutter APK');
      // Use debug — no signing config needed, works on any app out of the box
      execSync('flutter build apk --debug', {
        cwd: this.rootPath,
        stdio: 'inherit',
        timeout: 600000,
      });

      // E3: check both standard and alternative Flutter output paths
      const apkCandidates = [
        path.join(this.rootPath, 'build', 'app', 'outputs', 'flutter-apk', 'app-debug.apk'),
        path.join(this.rootPath, 'build', 'app', 'outputs', 'apk', 'debug', 'app-debug.apk'),
      ];
      const apkPath = apkCandidates.find((p) => fs.existsSync(p)) || this.findApk();
      if (!apkPath) throw new Error('Flutter APK not found after build');

      this.logger.log('Flutter APK built', { apkPath });
      return apkPath;
    } catch (error) {
      this.logger.error('Flutter build failed', error);
      throw error;
    }
  }

  private buildNativeAndroid(): string {
    try {
      this.logger.log('Building native Android APK with Gradle');

      // B5: Find gradlew dynamically
      const androidDir = this.findAndroidDir() || this.rootPath;
      const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

      if (process.platform !== 'win32' && fs.existsSync(path.join(androidDir, 'gradlew'))) {
        execSync('chmod +x gradlew', { cwd: androidDir });
      }

      // Use assembleDebug — no keystore needed, works on any app out of the box
      execSync(`${gradlew} assembleDebug`, {
        cwd: androidDir,
        stdio: 'inherit',
        timeout: 600000,
      });

      const apkPath = this.findApk();
      if (!apkPath) throw new Error('APK not found after Gradle build');

      this.logger.log('Native Android APK built', { apkPath });
      return apkPath;
    } catch (error) {
      this.logger.error('Gradle build failed', error);
      throw error;
    }
  }

  // B5: Find android project dir — gradlew might be in "android/", a custom-named dir, or root
  private findAndroidDir(): string | null {
    // 1. Check root itself
    if (fs.existsSync(path.join(this.rootPath, 'gradlew'))) return this.rootPath;

    // 2. Scan all immediate subdirs
    const skip = new Set(['node_modules', 'ios', 'build', 'dist', '.git', 'Pods']);
    try {
      for (const entry of fs.readdirSync(this.rootPath)) {
        if (skip.has(entry) || entry.startsWith('.')) continue;
        const full = path.join(this.rootPath, entry);
        try {
          if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'gradlew'))) {
            return full;
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    return null;
  }

  // E1: Broadly search for APK — don't rely on hardcoded paths
  private findApk(): string | null {
    const searchRoots = [this.rootPath];
    // also search inside android/ or equivalent
    const androidDir = this.findAndroidDir();
    if (androidDir && androidDir !== this.rootPath) searchRoots.push(androidDir);

    for (const searchRoot of searchRoots) {
      const found = this.walkForApk(searchRoot, 0, 6);
      if (found) return found;
    }
    return null;
  }

  private walkForApk(dir: string, depth: number, maxDepth: number): string | null {
    if (depth >= maxDepth) return null;
    const skip = new Set(['node_modules', '.git', 'Pods', 'intermediates', 'tmp']);
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (skip.has(entry) || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            const found = this.walkForApk(full, depth + 1, maxDepth);
            if (found) return found;
          } else if (entry.endsWith('.apk') && (dir.includes('release') || dir.includes('debug'))) {
            return full;
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return null;
  }
}
