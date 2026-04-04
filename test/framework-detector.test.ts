import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FrameworkDetector } from '../src/modules/code-reader/framework-detector';

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'detector-test-'));
}

function writeFile(base: string, relPath: string, content: string): void {
  const full = path.join(base, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function cleanDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('FrameworkDetector', () => {
  let detector: FrameworkDetector;
  let tmpDir: string;

  beforeEach(() => {
    detector = new FrameworkDetector();
    tmpDir = createTmpDir();
  });

  afterEach(() => { cleanDir(tmpDir); });

  describe('depth-2 scanning', () => {
    it('detects iOS project nested 2 levels deep', () => {
      writeFile(tmpDir, 'projects/ios/MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'projects/ios/AppDelegate.swift', 'import UIKit');

      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('swift');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('detects Android project nested 2 levels deep', () => {
      writeFile(tmpDir, 'mobile/android/build.gradle', `
apply plugin: 'com.android.application'
apply plugin: 'kotlin-android'
`);
      writeFile(tmpDir, 'mobile/android/app/src/main/java/Main.kt', '');

      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('kotlin');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('detects React Native at root level', () => {
      writeFile(tmpDir, 'package.json', JSON.stringify({
        dependencies: { 'react-native': '^0.72.0' },
      }));
      writeFile(tmpDir, 'metro.config.js', 'module.exports = {}');
      writeFile(tmpDir, 'android/settings.gradle', '');
      writeFile(tmpDir, 'ios/Podfile', '');

      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('react-native');
      expect(result.confidence).toBeGreaterThanOrEqual(50);
    });

    it('detects Flutter at root level', () => {
      writeFile(tmpDir, 'pubspec.yaml', 'name: app\ndependencies:\n  flutter:\n    sdk: flutter');
      writeFile(tmpDir, 'lib/main.dart', 'void main() {}');

      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('flutter');
      expect(result.confidence).toBeGreaterThanOrEqual(50);
    });

    it('returns native with 0 confidence for empty directory', () => {
      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('native');
      expect(result.confidence).toBe(0);
    });

    it('early exits when confidence is high', () => {
      // RN with high confidence at root should not need to scan deeper
      writeFile(tmpDir, 'package.json', JSON.stringify({
        dependencies: { 'react-native': '^0.72.0', '@react-navigation/native': '^6.0.0' },
      }));
      writeFile(tmpDir, 'metro.config.js', 'module.exports = {}');
      writeFile(tmpDir, 'app.json', JSON.stringify({ name: 'MyApp' }));
      writeFile(tmpDir, 'android/settings.gradle', '');
      writeFile(tmpDir, 'ios/Podfile', '');

      // Put a Swift project deep that should be ignored due to early exit
      writeFile(tmpDir, 'other/deep/MyApp.xcodeproj/project.pbxproj', '');

      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('react-native');
      expect(result.confidence).toBeGreaterThanOrEqual(80);
    });
  });

  describe('Swift detection', () => {
    it('detects Xcode project with Podfile', () => {
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'Podfile', 'platform :ios, "15.0"');
      writeFile(tmpDir, 'AppDelegate.swift', 'import UIKit\nclass AppDelegate: UIResponder {}');

      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('swift');
      expect(result.confidence).toBeGreaterThanOrEqual(20);
      expect(result.buildSystem).toBe('xcode');
    });

    it('detects SwiftUI sub-framework', () => {
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'ContentView.swift', `
import SwiftUI
struct ContentView: View {
  var body: some View { Text("Hello") }
}
`);

      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('swift');
      expect(result.subFramework).toBe('swiftui');
    });

    it('detects storyboard sub-framework', () => {
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'Base.lproj/Main.storyboard', '<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" />');

      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('swift');
      expect(result.subFramework).toBe('storyboard');
    });
  });

  describe('Kotlin detection', () => {
    it('detects Jetpack Compose sub-framework', () => {
      writeFile(tmpDir, 'build.gradle.kts', `
plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
dependencies { implementation("androidx.compose.ui:ui:1.5.0") }
`);

      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('kotlin');
      expect(result.subFramework).toBe('jetpack-compose');
    });

    it('detects XML layouts sub-framework', () => {
      writeFile(tmpDir, 'build.gradle', 'apply plugin: "com.android.application"\napply plugin: "kotlin-android"');
      writeFile(tmpDir, 'app/src/main/res/layout/activity_main.xml', '<LinearLayout />');

      const result = detector.detect(tmpDir);
      expect(result.framework).toBe('kotlin');
      expect(result.subFramework).toBe('xml-layouts');
    });
  });
});
