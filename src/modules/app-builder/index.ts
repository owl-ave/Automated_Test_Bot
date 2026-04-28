import * as fs from 'fs';
import * as path from 'path';
import { PipelineContext, ModuleResult } from '../../types';
import { AndroidBuilder } from './android-builder';
import { IosBuilder } from './ios-builder';
import { BrowserStackUploader } from './browserstack-uploader';
import { Logger } from '../../utils/logger';

export async function runAppBuilder(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('AppBuilder');

  try {
    const username = process.env.BROWSERSTACK_USERNAME;
    const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;

    if (!username || !accessKey) {
      throw new Error('BrowserStack credentials not found in environment variables');
    }

    const uploader = new BrowserStackUploader(username, accessKey);
    const buildTimestamp = new Date().toISOString();
    const buildId = `${context.prNumber}-${Date.now()}`;

    const buildResult = {
      androidAppUrl: undefined as string | undefined,
      iosAppUrl: undefined as string | undefined,
      androidCustomId: undefined as string | undefined,
      iosCustomId: undefined as string | undefined,
      buildTimestamp,
    };

    // --- Option 1: Pre-built app URL (for local testing / CI with pre-built artifacts) ---
    const androidUrl = process.env.ANDROID_APP_URL;
    const iosUrl = process.env.IOS_APP_URL;

    if (androidUrl || iosUrl) {
      logger.log('Using pre-built app URL(s) — skipping local build');

      if (androidUrl) {
        const customId = `android-pr-${buildId}`;
        const upload = await uploader.uploadAppUrl(androidUrl, customId);
        buildResult.androidAppUrl = upload.app_url;
        buildResult.androidCustomId = customId;
        logger.log('Android app uploaded via URL', { app_url: upload.app_url });
      }

      if (iosUrl) {
        const customId = `ios-pr-${buildId}`;
        const upload = await uploader.uploadAppUrl(iosUrl, customId);
        buildResult.iosAppUrl = upload.app_url;
        buildResult.iosCustomId = customId;
        logger.log('iOS app uploaded via URL', { app_url: upload.app_url });
      }

      context.appBuild = buildResult;
      return { moduleName: 'AppBuilder', status: 'success', data: buildResult };
    }

    // --- Option 2: Build from source ---
    const buildPath = context.mobilePath || context.targetPath;
    const framework = context.codeAnalysis?.framework;

    if (!buildPath || buildPath === context.targetPath) {
      // mobilePath not set — CodeReader didn't find a distinct mobile subdir.
      // Do a broader check before giving up.
      if (!hasMobileProject(buildPath)) {
        logger.warn('No mobile project detected in target repo — skipping app build');
        return { moduleName: 'AppBuilder', status: 'warning', error: 'No mobile project found in target repo' };
      }
    }

    // Determine which platforms to build:
    // Swift-only → iOS, Kotlin-only → Android, anything else → both
    const shouldBuildAndroid = framework !== 'swift';
    const shouldBuildIos = framework !== 'kotlin';

    logger.log('Building from mobile path', { buildPath, framework, android: shouldBuildAndroid, ios: shouldBuildIos });

    // Capture per-platform errors so we can surface the real reason when both fail.
    const platformErrors: Record<'android' | 'ios', string | undefined> = { android: undefined, ios: undefined };

    // Build Android — G1: pass context framework to builder
    if (shouldBuildAndroid) {
      try {
        logger.log('Starting Android build');
        const androidBuilder = new AndroidBuilder(buildPath, framework);
        const androidApkPath = await androidBuilder.build();

        logger.log('Android APK built, uploading to BrowserStack', { apkPath: androidApkPath });
        const androidCustomId = `android-pr-${buildId}`;
        const androidUpload = await uploader.uploadApp(androidApkPath, androidCustomId);

        buildResult.androidAppUrl = androidUpload.app_url;
        buildResult.androidCustomId = androidCustomId;
        logger.log('Android app uploaded', { app_url: androidUpload.app_url });
      } catch (error) {
        const msg = (error as Error)?.message || String(error);
        platformErrors.android = msg;
        logger.warn('Android build failed, continuing with iOS', error);
        context.logs.push(`AppBuilder - Android: ${msg}`);
      }
    } else {
      logger.log('Skipping Android build — Swift/iOS-only project detected');
    }

    // Build iOS — G1: pass context framework to builder
    if (shouldBuildIos) {
      try {
        logger.log('Starting iOS build');
        const iosBuilder = new IosBuilder(buildPath, framework);
        const iosIpaPath = await iosBuilder.build();

        logger.log('iOS IPA built, uploading to BrowserStack', { ipaPath: iosIpaPath });
        const iosCustomId = `ios-pr-${buildId}`;
        const iosUpload = await uploader.uploadApp(iosIpaPath, iosCustomId);

        buildResult.iosAppUrl = iosUpload.app_url;
        buildResult.iosCustomId = iosCustomId;
        logger.log('iOS app uploaded', { app_url: iosUpload.app_url });
      } catch (error) {
        const msg = (error as Error)?.message || String(error);
        platformErrors.ios = msg;
        logger.warn('iOS build failed, continuing', error);
        context.logs.push(`AppBuilder - iOS: ${msg}`);
      }
    } else {
      logger.log('Skipping iOS build — Kotlin/Android-only project detected');
    }

    const attempted: string[] = [];
    const succeeded: string[] = [];
    if (shouldBuildAndroid) {
      attempted.push('android');
      if (buildResult.androidAppUrl) succeeded.push('android');
    }
    if (shouldBuildIos) {
      attempted.push('ios');
      if (buildResult.iosAppUrl) succeeded.push('ios');
    }
    if (attempted.length > 0 && succeeded.length === 0) {
      // Surface the underlying platform error(s) instead of a generic "App build failed".
      const parts: string[] = [];
      if (platformErrors.android) parts.push(`Android: ${platformErrors.android}`);
      if (platformErrors.ios) parts.push(`iOS: ${platformErrors.ios}`);
      const detail = parts.length > 0 ? `\n${parts.join('\n\n')}` : '';
      throw new Error(`App build failed (attempted: ${attempted.join(', ')})${detail}`);
    }

    context.appBuild = buildResult;
    logger.log('App build complete', buildResult);

    return { moduleName: 'AppBuilder', status: 'success', data: buildResult };
  } catch (error) {
    logger.error('App build failed', error);
    return { moduleName: 'AppBuilder', status: 'error', error: String(error) };
  }
}

/**
 * Broadly checks if a directory contains a mobile project.
 * Scans root + all immediate subdirectories so non-standard folder names are found.
 */
function hasMobileProject(buildPath: string): boolean {
  const skip = new Set(['node_modules', 'Pods', 'build', 'dist', '.git']);

  // B5: Scan root + immediate subdirs for gradlew
  const hasGradlew = (() => {
    if (fs.existsSync(path.join(buildPath, 'gradlew'))) return true;
    try {
      for (const entry of fs.readdirSync(buildPath)) {
        if (skip.has(entry) || entry.startsWith('.')) continue;
        const full = path.join(buildPath, entry);
        try {
          if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'gradlew'))) return true;
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return false;
  })();

  // B2/B3: Scan root + immediate subdirs for .xcodeproj/.xcworkspace
  const hasXcodeProj = (() => {
    const dirsToSearch = [buildPath];
    try {
      for (const entry of fs.readdirSync(buildPath)) {
        if (skip.has(entry) || entry.startsWith('.')) continue;
        const full = path.join(buildPath, entry);
        try { if (fs.statSync(full).isDirectory()) dirsToSearch.push(full); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return dirsToSearch.some((dir) => {
      try { return fs.readdirSync(dir).some((f) => f.endsWith('.xcworkspace') || f.endsWith('.xcodeproj')); }
      catch { return false; }
    });
  })();

  // B8: Scan root + immediate subdirs for pubspec.yaml
  const hasPubspec = (() => {
    if (fs.existsSync(path.join(buildPath, 'pubspec.yaml'))) return true;
    try {
      for (const entry of fs.readdirSync(buildPath)) {
        if (skip.has(entry) || entry.startsWith('.')) continue;
        const full = path.join(buildPath, entry);
        try {
          if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'pubspec.yaml'))) return true;
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return false;
  })();

  // B6: React Native — check package.json in root and immediate subdirs
  const hasReactNative = (() => {
    const candidates = [path.join(buildPath, 'package.json')];
    try {
      for (const entry of fs.readdirSync(buildPath)) {
        if (skip.has(entry) || entry.startsWith('.')) continue;
        const full = path.join(buildPath, entry);
        try {
          if (fs.statSync(full).isDirectory()) candidates.push(path.join(full, 'package.json'));
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return candidates.some((pkgPath) => {
      if (!fs.existsSync(pkgPath)) return false;
      try { return fs.readFileSync(pkgPath, 'utf-8').includes('react-native'); }
      catch { return false; }
    });
  })();

  return hasGradlew || hasXcodeProj || hasPubspec || hasReactNative;
}
