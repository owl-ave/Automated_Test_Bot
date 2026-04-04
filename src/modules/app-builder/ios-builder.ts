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

      const derivedDataPath = path.join(this.rootPath, 'build', 'DerivedData');
      execSync(
        `xcodebuild ${workspaceArg} -scheme "${schemeName}" ` +
        `-configuration Debug -derivedDataPath "${derivedDataPath}" ` +
        `-destination "generic/platform=iOS" ` +
        `CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO ` +
        `build`,
        {
          cwd: this.rootPath,
          stdio: 'inherit',
          timeout: 600000,
        },
      );

      // Package .app into .ipa
      const appPath = this.findApp(derivedDataPath);
      if (!appPath) throw new Error('.app not found after build');

      const ipaDir = path.join(this.rootPath, 'build', 'ipa');
      const payloadDir = path.join(ipaDir, 'Payload');
      fs.mkdirSync(payloadDir, { recursive: true });
      execSync(`cp -R "${appPath}" "${payloadDir}/"`, { stdio: 'inherit' });
      const appName = path.basename(appPath, '.app');
      const ipaPath = path.join(ipaDir, `${appName}.ipa`);
      execSync(`cd "${ipaDir}" && zip -r "${ipaPath}" Payload`, { stdio: 'inherit' });

      if (!fs.existsSync(ipaPath)) throw new Error('IPA packaging failed');

      this.logger.log('React Native IPA built', { ipaPath });
      return ipaPath;
    } catch (error: any) {
      this.logger.error('React Native iOS build failed', { message: error?.message || String(error) });
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
    } catch (error: any) {
      this.logger.error('Flutter iOS build failed', { message: error?.message || String(error) });
      throw error;
    }
  }

  private buildNativeIos(): string {
    try {
      this.logger.log('Building native iOS app with xcodebuild');

      const workspaceFile = this.findWorkspaceOrProject();
      if (!workspaceFile) throw new Error('iOS workspace or project not found — searched root and subdirectories');

      const projectDir = path.dirname(workspaceFile);
      const isWorkspace = workspaceFile.endsWith('.xcworkspace');
      const workspaceArg = isWorkspace ? `-workspace "${workspaceFile}"` : `-project "${workspaceFile}"`;
      const schemeName = path.basename(workspaceFile, isWorkspace ? '.xcworkspace' : '.xcodeproj');

      this.logger.log('Found Xcode project', { workspaceFile, projectDir, schemeName });

      // Install CocoaPods if Podfile exists
      const podfilePath = fs.existsSync(path.join(projectDir, 'Podfile'))
        ? projectDir
        : fs.existsSync(path.join(this.rootPath, 'Podfile'))
          ? this.rootPath
          : null;
      if (podfilePath && !fs.existsSync(path.join(podfilePath, 'Pods'))) {
        this.logger.log('Installing CocoaPods dependencies');
        this.exec(`pod install --repo-update`, podfilePath);
      }

      // List available schemes
      let resolvedScheme = schemeName;
      try {
        const schemesOutput = execSync(
          `xcodebuild ${workspaceArg} -list -json`,
          { cwd: projectDir, encoding: 'utf-8', timeout: 30000 },
        );
        const info = JSON.parse(schemesOutput);
        const schemes: string[] = info.workspace?.schemes ?? info.project?.schemes ?? [];
        this.logger.log('Available schemes', { schemes });
        if (schemes.length && !schemes.includes(schemeName)) {
          resolvedScheme = schemes[0];
          this.logger.log(`Scheme "${schemeName}" not found, using "${resolvedScheme}"`);
        }
      } catch (e) {
        this.logger.warn('Could not list schemes, using guessed name', e);
      }

      // Resolve Swift Package Manager dependencies
      this.logger.log('Resolving package dependencies');
      try {
        this.exec(
          `xcodebuild ${workspaceArg} -scheme "${resolvedScheme}" -resolvePackageDependencies`,
          projectDir,
        );
      } catch {
        this.logger.warn('SPM resolve failed — continuing (may not use SPM)');
      }

      // Build .app (no code signing required for BrowserStack)
      const derivedDataPath = path.join(projectDir, 'build', 'DerivedData');
      this.logger.log('Starting xcodebuild', { scheme: resolvedScheme, derivedDataPath });
      this.exec(
        `xcodebuild ${workspaceArg} -scheme "${resolvedScheme}" ` +
        `-configuration Debug -derivedDataPath "${derivedDataPath}" ` +
        `-destination "generic/platform=iOS Simulator" ` +
        `CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO ` +
        `ONLY_ACTIVE_ARCH=NO ` +
        `build`,
        projectDir,
        600000,
      );

      // Find .app and package into .ipa
      const appPath = this.findApp(derivedDataPath);
      if (!appPath) throw new Error('.app not found after xcodebuild — check build output above');

      const ipaDir = path.join(projectDir, 'build', 'ipa');
      const payloadDir = path.join(ipaDir, 'Payload');
      fs.mkdirSync(payloadDir, { recursive: true });
      execSync(`cp -R "${appPath}" "${payloadDir}/"`, { stdio: 'inherit' });
      const appName = path.basename(appPath, '.app');
      const ipaPath = path.join(ipaDir, `${appName}.ipa`);
      execSync(`cd "${ipaDir}" && zip -r "${ipaPath}" Payload`, { stdio: 'inherit' });

      if (!fs.existsSync(ipaPath)) throw new Error('IPA packaging failed');

      this.logger.log('Native iOS IPA built', { ipaPath });
      return ipaPath;
    } catch (error: any) {
      this.logger.error('Native iOS build failed', { message: error?.message || String(error) });
      throw error;
    }
  }

  /** Run a command with output captured and logged on failure */
  private exec(cmd: string, cwd: string, timeout = 120000): void {
    try {
      execSync(cmd, { cwd, stdio: 'inherit', timeout });
    } catch (error: any) {
      const msg = error?.stderr?.toString?.()?.slice(-2000) || error?.message || String(error);
      this.logger.error('Command failed', { cmd: cmd.slice(0, 120), error: msg });
      throw new Error(`Command failed: ${cmd.slice(0, 120)}\n${msg}`);
    }
  }

  private findWorkspaceOrProject(): string | null {
    // Search root first
    const rootMatch = this.findXcodeFiles(this.rootPath);
    if (rootMatch) return rootMatch;

    // Search one level deep
    const entries = fs.readdirSync(this.rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'build') continue;
      const subMatch = this.findXcodeFiles(path.join(this.rootPath, entry.name));
      if (subMatch) return subMatch;
    }

    return null;
  }

  private findXcodeFiles(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);

    // Prefer workspace (usually has CocoaPods/SPM configured)
    const workspace = files.find((f) => f.endsWith('.xcworkspace'));
    if (workspace) return path.join(dir, workspace);

    const project = files.find((f) => f.endsWith('.xcodeproj'));
    if (project) return path.join(dir, project);

    return null;
  }

  private findApp(derivedDataPath: string): string | null {
    const productsDir = path.join(derivedDataPath, 'Build', 'Products');
    if (!fs.existsSync(productsDir)) return null;

    for (const config of fs.readdirSync(productsDir)) {
      const configDir = path.join(productsDir, config);
      if (!fs.statSync(configDir).isDirectory()) continue;
      const entries = fs.readdirSync(configDir);
      const app = entries.find((f) => f.endsWith('.app'));
      if (app) return path.join(configDir, app);
    }
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
