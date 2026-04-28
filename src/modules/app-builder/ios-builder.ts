import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import { Logger } from '../../utils/logger';

export class IosBuilder {
  private logger = new Logger('IosBuilder');
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
      return this.buildNativeIos();
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
      this.logger.log('Building React Native IPA');

      // Install JS dependencies — detect yarn vs npm
      if (!fs.existsSync(path.join(this.rootPath, 'node_modules'))) {
        const useYarn = fs.existsSync(path.join(this.rootPath, 'yarn.lock'));
        const installCmd = useYarn ? 'yarn install --frozen-lockfile' : 'npm install';
        this.logger.log('Installing React Native dependencies', { packageManager: useYarn ? 'yarn' : 'npm' });
        execSync(installCmd, { cwd: this.rootPath, stdio: 'inherit', timeout: 300000 });
      }

      // B3: Find ios dir dynamically — might not be named "ios/"
      const iosDir = this.findIosDir();
      if (!iosDir) throw new Error('iOS project directory not found in any subfolder');

      // Install pods if not already installed
      if (!fs.existsSync(path.join(iosDir, 'Pods'))) {
        this.logger.log('Installing CocoaPods dependencies');
        // D6: Add timeout to pod install
        execSync('bundle exec pod install || pod install', {
          cwd: iosDir,
          stdio: 'inherit',
          shell: '/bin/bash' as any,
          timeout: 300000,
        });
      }

      const workspaceFile = this.findWorkspaceOrProject();
      if (!workspaceFile) throw new Error('iOS workspace or project not found');

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
        { cwd: this.rootPath, stdio: 'inherit', timeout: 600000 },
      );

      const appPath = this.findApp(derivedDataPath);
      if (!appPath) throw new Error('.app not found after build');

      return this.packageIpa(appPath, path.join(this.rootPath, 'build', 'ipa'));
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
        timeout: 600000, // D8: was missing timeout
      });

      // E4: check multiple possible Flutter IPA output paths
      const ipaCandidates = [
        path.join(this.rootPath, 'build', 'ios', 'ipa', 'app.ipa'),
        path.join(this.rootPath, 'build', 'ios', 'ipa'),
        path.join(this.rootPath, 'build', 'ios', 'archive'),
      ];

      // Try known path first
      const directPath = path.join(this.rootPath, 'build', 'ios', 'ipa', 'app.ipa');
      if (fs.existsSync(directPath)) {
        this.logger.log('Flutter IPA built', { ipaPath: directPath });
        return directPath;
      }

      // Scan build/ios/ipa/ for any .ipa file
      for (const candidate of ipaCandidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
          const stat = fs.statSync(candidate);
          if (stat.isDirectory()) {
            const ipa = fs.readdirSync(candidate).find((f) => f.endsWith('.ipa'));
            if (ipa) {
              const ipaPath = path.join(candidate, ipa);
              this.logger.log('Flutter IPA built', { ipaPath });
              return ipaPath;
            }
          }
        } catch { /* ignore */ }
      }

      throw new Error('Flutter IPA not found after build — checked build/ios/ipa/');
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
        // D6: timeout on pod install
        this.exec('pod install --repo-update', podfilePath, 300000);
      }

      // Resolve Swift Package Manager dependencies FIRST — Firebase/Sentry/Privy are heavy
      // and a cold fetch can exceed 30s. Doing this before -list keeps the list call fast.
      const spmCacheDir = path.join(projectDir, 'build', 'SourcePackages');
      try {
        this.exec(
          `xcodebuild ${workspaceArg} -resolvePackageDependencies -clonedSourcePackagesDirPath "${spmCacheDir}"`,
          projectDir,
          300000,
        );
      } catch (e: any) {
        this.logger.warn('SPM resolve failed — continuing (may not use SPM)', { message: e?.message });
      }

      // List available schemes (now fast — packages already resolved)
      let resolvedScheme = schemeName;
      try {
        const schemesOutput = execSync(
          `xcodebuild ${workspaceArg} -list -json`,
          { cwd: projectDir, encoding: 'utf-8', timeout: 60000 },
        );
        const info = JSON.parse(schemesOutput);
        const schemes: string[] = info.workspace?.schemes ?? info.project?.schemes ?? [];
        this.logger.log('Available schemes', { schemes });
        if (schemes.length && !schemes.includes(schemeName)) {
          resolvedScheme = schemes[0];
          this.logger.log(`Scheme "${schemeName}" not found, using "${resolvedScheme}"`);
        }
      } catch (e: any) {
        this.logger.error('Could not list schemes, falling back to guessed name', {
          guessed: schemeName,
          message: e?.message || String(e),
        });
      }

      const derivedDataPath = path.join(projectDir, 'build', 'DerivedData');
      this.logger.log('Starting xcodebuild', { scheme: resolvedScheme, derivedDataPath });
      // Build for real device (not simulator) — BrowserStack App Automate needs device builds.
      // Code signing disabled: BrowserStack re-signs the app with their own certificate.
      this.exec(
        `xcodebuild ${workspaceArg} -scheme "${resolvedScheme}" ` +
        `-configuration Debug -derivedDataPath "${derivedDataPath}" ` +
        `-destination "generic/platform=iOS" ` +
        `CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO ` +
        `ONLY_ACTIVE_ARCH=NO build`,
        projectDir,
        600000,
      );

      const appPath = this.findApp(derivedDataPath);
      if (!appPath) throw new Error('.app not found after xcodebuild — check build output above');

      return this.packageIpa(appPath, path.join(projectDir, 'build', 'ipa'));
    } catch (error: any) {
      this.logger.error('Native iOS build failed', { message: error?.message || String(error) });
      throw error;
    }
  }

  /** Package a .app bundle into a .ipa file */
  private packageIpa(appPath: string, ipaDir: string): string {
    const payloadDir = path.join(ipaDir, 'Payload');
    fs.mkdirSync(payloadDir, { recursive: true });
    execSync(`cp -R "${appPath}" "${payloadDir}/"`, { stdio: 'inherit' });
    const appName = path.basename(appPath, '.app');
    const ipaPath = path.join(ipaDir, `${appName}.ipa`);
    execSync(`cd "${ipaDir}" && zip -r "${ipaPath}" Payload`, { stdio: 'inherit' });
    if (!fs.existsSync(ipaPath)) throw new Error('IPA packaging failed');
    this.logger.log('IPA packaged', { ipaPath });
    return ipaPath;
  }

  /** Run a command with output streamed AND captured, so failures surface in the bot's log */
  private exec(cmd: string, cwd: string, timeout = 120000): void {
    const result = spawnSync(cmd, {
      cwd,
      shell: true,
      timeout,
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    if (result.error || result.status !== 0) {
      const tail = (s: string) => (s || '').slice(-4000);
      const stderr = tail(result.stderr || '');
      const stdout = tail(result.stdout || '');
      const errMsg = result.error?.message || `exit ${result.status}`;
      this.logger.error('Command failed', {
        cmd: cmd.slice(0, 200),
        exit: result.status,
        signal: result.signal,
        error: errMsg,
        stderrTail: stderr,
      });
      throw new Error(
        `Command failed (${errMsg}): ${cmd.slice(0, 200)}\n` +
        `--- stderr (last 4KB) ---\n${stderr || '(empty)'}\n` +
        `--- stdout (last 4KB) ---\n${stdout || '(empty)'}`,
      );
    }
  }

  // B3: Find ios project dir — might be named anything, not just "ios/"
  private findIosDir(): string | null {
    const skip = new Set(['node_modules', 'android', 'build', 'dist', '.git', 'Pods']);

    // Scan all immediate subdirs for Podfile or .xcodeproj/.xcworkspace
    try {
      for (const entry of fs.readdirSync(this.rootPath)) {
        if (skip.has(entry) || entry.startsWith('.')) continue;
        const full = path.join(this.rootPath, entry);
        try {
          if (!fs.statSync(full).isDirectory()) continue;
          const files = fs.readdirSync(full);
          if (
            files.some((f) => f.endsWith('.xcworkspace') || f.endsWith('.xcodeproj') || f === 'Podfile')
          ) {
            return full;
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    return null;
  }

  // B3: Search root + 2 levels deep for .xcworkspace/.xcodeproj (any folder name)
  private findWorkspaceOrProject(): string | null {
    return this.findXcodeFiles(this.rootPath, 0, 2);
  }

  private findXcodeFiles(dir: string, depth: number, maxDepth: number): string | null {
    if (!fs.existsSync(dir)) return null;
    const skip = new Set(['node_modules', 'build', 'dist', '.git', 'Pods', 'DerivedData']);

    try {
      const files = fs.readdirSync(dir);

      // Prefer workspace over project at this level
      const workspace = files.find((f) => f.endsWith('.xcworkspace') && !f.includes('project.xcworkspace'));
      if (workspace) return path.join(dir, workspace);

      const project = files.find((f) => f.endsWith('.xcodeproj'));
      if (project) return path.join(dir, project);

      // Recurse into subdirectories
      if (depth < maxDepth) {
        for (const entry of files) {
          if (skip.has(entry) || entry.startsWith('.')) continue;
          const full = path.join(dir, entry);
          try {
            if (fs.statSync(full).isDirectory()) {
              const found = this.findXcodeFiles(full, depth + 1, maxDepth);
              if (found) return found;
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    return null;
  }

  private findApp(derivedDataPath: string): string | null {
    const productsDir = path.join(derivedDataPath, 'Build', 'Products');
    if (!fs.existsSync(productsDir)) return null;

    for (const config of fs.readdirSync(productsDir)) {
      const configDir = path.join(productsDir, config);
      try {
        if (!fs.statSync(configDir).isDirectory()) continue;
        const entries = fs.readdirSync(configDir);
        const app = entries.find((f) => f.endsWith('.app'));
        if (app) return path.join(configDir, app);
      } catch { /* ignore */ }
    }
    return null;
  }
}
