import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Logger } from '../../utils/logger';

export class IosBuilder {
  private logger = new Logger('IosBuilder');
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
      return this.buildNativeIos();
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
      this.logger.log('Building React Native IPA');

      // Install JS dependencies — detect yarn vs npm
      if (!fs.existsSync(path.join(this.rootPath, 'node_modules'))) {
        const useYarn = fs.existsSync(path.join(this.rootPath, 'yarn.lock'));
        const installCmd = useYarn ? 'yarn install --frozen-lockfile' : 'npm install';
        this.logger.log('Installing React Native dependencies', { packageManager: useYarn ? 'yarn' : 'npm' });
        execSync(installCmd, { cwd: this.rootPath, stdio: 'inherit', timeout: 300000 });
      }

      const iosDir = path.join(this.rootPath, 'ios');

      // Install pods if not already installed
      if (!fs.existsSync(path.join(iosDir, 'Pods'))) {
        this.logger.log('Installing CocoaPods dependencies');
        execSync('bundle exec pod install || pod install', { cwd: iosDir, stdio: 'inherit', shell: '/bin/bash' as any });
      }

      // Dynamically detect workspace and scheme
      const workspaceFile = this.findWorkspaceOrProject();
      if (!workspaceFile) throw new Error('iOS workspace or project not found in ios/ directory');

      const isWorkspace = workspaceFile.endsWith('.xcworkspace');
      const workspaceArg = isWorkspace ? `-workspace ${workspaceFile}` : `-project ${workspaceFile}`;
      const schemeName = path.basename(workspaceFile, isWorkspace ? '.xcworkspace' : '.xcodeproj');

      execSync(
        `xcodebuild ${workspaceArg} -scheme ${schemeName} -configuration Release -derivedDataPath build -sdk iphoneos`,
        {
          cwd: this.rootPath,
          stdio: 'inherit',
        },
      );

      const ipaPath = this.findIpa();
      if (!ipaPath) throw new Error('IPA not found after build');

      this.logger.log('React Native IPA built', { ipaPath });
      return ipaPath;
    } catch (error) {
      this.logger.error('React Native iOS build failed', error);
      throw error;
    }
  }

  private buildFlutter(): string {
    try {
      this.logger.log('Building Flutter IPA');
      execSync('flutter build ipa --release', {
        cwd: this.rootPath,
        stdio: 'inherit',
      });

      const ipaPath = path.join(this.rootPath, 'build', 'ios', 'ipa', 'app.ipa');
      if (!fs.existsSync(ipaPath)) throw new Error(`Flutter IPA not found at ${ipaPath}`);

      this.logger.log('Flutter IPA built', { ipaPath });
      return ipaPath;
    } catch (error) {
      this.logger.error('Flutter iOS build failed', error);
      throw error;
    }
  }

  private buildNativeIos(): string {
    try {
      this.logger.log('Building native iOS app with xcodebuild');

      // Find workspace or project file
      const workspaceFile = this.findWorkspaceOrProject();
      if (!workspaceFile) throw new Error('iOS workspace or project not found');

      const isWorkspace = workspaceFile.endsWith('.xcworkspace');
      const workspaceArg = isWorkspace ? `-workspace ${workspaceFile}` : `-project ${workspaceFile}`;

      // Get scheme (usually same as project name)
      const schemeName = path.basename(workspaceFile, isWorkspace ? '.xcworkspace' : '.xcodeproj');

      execSync(
        `xcodebuild ${workspaceArg} -scheme ${schemeName} -configuration Release -derivedDataPath build archive -archivePath build/archive.xcarchive`,
        {
          cwd: this.rootPath,
          stdio: 'inherit',
        },
      );

      // Export IPA from archive
      execSync(
        'xcodebuild -exportArchive -archivePath build/archive.xcarchive -exportOptionsPlist build/ExportOptions.plist -exportPath build/ipa',
        {
          cwd: this.rootPath,
          stdio: 'inherit',
        },
      );

      const ipaPath = this.findIpa();
      if (!ipaPath) throw new Error('IPA not found after xcodebuild');

      this.logger.log('Native iOS IPA built', { ipaPath });
      return ipaPath;
    } catch (error) {
      this.logger.error('Native iOS build failed', error);
      throw error;
    }
  }

  private findWorkspaceOrProject(): string | null {
    const files = fs.readdirSync(this.rootPath);

    // Prefer workspace
    const workspace = files.find((f) => f.endsWith('.xcworkspace'));
    if (workspace) return path.join(this.rootPath, workspace);

    // Fall back to project
    const project = files.find((f) => f.endsWith('.xcodeproj'));
    if (project) return path.join(this.rootPath, project);

    return null;
  }

  private findIpa(): string | null {
    const searchPaths = [path.join(this.rootPath, 'build', 'ipa'), path.join(this.rootPath, 'build', 'ios', 'ipa')];

    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath)) {
        const files = fs.readdirSync(searchPath);
        const ipa = files.find((f) => f.endsWith('.ipa'));
        if (ipa) return path.join(searchPath, ipa);
      }
    }

    return null;
  }
}
