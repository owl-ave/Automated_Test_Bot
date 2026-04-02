import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Logger } from '../../utils/logger';

export class AndroidBuilder {
  private logger = new Logger('AndroidBuilder');
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  async build(): Promise<string> {
    const framework = this.detectFramework();

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
      const content = fs.readFileSync(packageJson, 'utf-8');
      if (content.includes('react-native')) return 'react-native';
    }
    if (fs.existsSync(pubspecYaml)) return 'flutter';
    return 'native';
  }

  private buildReactNative(): string {
    try {
      this.logger.log('Building React Native APK');
      const androidDir = path.join(this.rootPath, 'android');
      const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

      execSync(`${gradlew} assembleRelease`, {
        cwd: androidDir,
        stdio: 'inherit',
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
      execSync('flutter build apk --release', {
        cwd: this.rootPath,
        stdio: 'inherit',
      });

      const apkPath = path.join(this.rootPath, 'build', 'app', 'outputs', 'flutter-apk', 'app-release.apk');
      if (!fs.existsSync(apkPath)) throw new Error(`Flutter APK not found at ${apkPath}`);

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
      execSync('./gradlew assembleRelease', {
        cwd: this.rootPath,
        stdio: 'inherit',
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

  private findApk(): string | null {
    const buildDir = path.join(this.rootPath, 'build');
    const androidDir = path.join(this.rootPath, 'android');

    const searchPaths = [
      path.join(buildDir, 'outputs', 'apk', 'release'),
      path.join(buildDir, 'outputs', 'flutter-apk'),
      path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release'),
    ];

    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath)) {
        const files = fs.readdirSync(searchPath);
        const apk = files.find((f) => f.endsWith('.apk'));
        if (apk) return path.join(searchPath, apk);
      }
    }

    return null;
  }
}
