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

    if (!buildPath || buildPath === context.targetPath) {
      // Double check — no mobilePath means CodeReader didn't find a mobile project
      const fs = await import('fs');
      const hasGradlew = fs.existsSync(path.join(buildPath, 'gradlew')) ||
                         fs.existsSync(path.join(buildPath, 'android', 'gradlew'));
      const hasXcodeProj = fs.readdirSync(buildPath).some((f: string) =>
        f.endsWith('.xcworkspace') || f.endsWith('.xcodeproj'));
      const hasPubspec = fs.existsSync(path.join(buildPath, 'pubspec.yaml'));
      const hasReactNative = fs.existsSync(path.join(buildPath, 'package.json')) &&
        fs.readFileSync(path.join(buildPath, 'package.json'), 'utf-8').includes('react-native');

      if (!hasGradlew && !hasXcodeProj && !hasPubspec && !hasReactNative) {
        logger.warn('No mobile project detected in target repo — skipping app build');
        return { moduleName: 'AppBuilder', status: 'warning', error: 'No mobile project found in target repo' };
      }
    }

    logger.log('Building from mobile path', { buildPath });

    // Build Android
    try {
      logger.log('Starting Android build');
      const androidBuilder = new AndroidBuilder(buildPath);
      const androidApkPath = await androidBuilder.build();

      logger.log('Android APK built, uploading to BrowserStack', { apkPath: androidApkPath });
      const androidCustomId = `android-pr-${buildId}`;
      const androidUpload = await uploader.uploadApp(androidApkPath, androidCustomId);

      buildResult.androidAppUrl = androidUpload.app_url;
      buildResult.androidCustomId = androidCustomId;
      logger.log('Android app uploaded', { app_url: androidUpload.app_url });
    } catch (error) {
      logger.warn('Android build failed, continuing with iOS', error);
      context.logs.push(`AppBuilder - Android: ${String(error)}`);
    }

    // Build iOS
    try {
      logger.log('Starting iOS build');
      const iosBuilder = new IosBuilder(buildPath);
      const iosIpaPath = await iosBuilder.build();

      logger.log('iOS IPA built, uploading to BrowserStack', { ipaPath: iosIpaPath });
      const iosCustomId = `ios-pr-${buildId}`;
      const iosUpload = await uploader.uploadApp(iosIpaPath, iosCustomId);

      buildResult.iosAppUrl = iosUpload.app_url;
      buildResult.iosCustomId = iosCustomId;
      logger.log('iOS app uploaded', { app_url: iosUpload.app_url });
    } catch (error) {
      logger.warn('iOS build failed, continuing', error);
      context.logs.push(`AppBuilder - iOS: ${String(error)}`);
    }

    if (!buildResult.androidAppUrl && !buildResult.iosAppUrl) {
      throw new Error('Both Android and iOS builds failed');
    }

    context.appBuild = buildResult;
    logger.log('App build complete', buildResult);

    return { moduleName: 'AppBuilder', status: 'success', data: buildResult };
  } catch (error) {
    logger.error('App build failed', error);
    return { moduleName: 'AppBuilder', status: 'error', error: String(error) };
  }
}
