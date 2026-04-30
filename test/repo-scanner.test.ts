import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RepoScanner } from '../src/modules/code-reader/repo-scanner';

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'));
}

function writeFile(base: string, relPath: string, content: string): void {
  const full = path.join(base, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function cleanDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('RepoScanner', () => {
  describe('Swift screen scanning', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = createTmpDir(); });
    afterEach(() => { cleanDir(tmpDir); });

    it('detects UIViewController subclasses', () => {
      // Create a minimal Swift iOS project so framework detector picks swift
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'LoginViewController.swift', `
import UIKit
class LoginViewController: UIViewController {
  override func viewDidLoad() { super.viewDidLoad() }
}
`);
      writeFile(tmpDir, 'ProfileViewController.swift', `
import UIKit
class ProfileViewController: UITableViewController {
  override func viewDidLoad() { super.viewDidLoad() }
}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      expect(result.framework).toBe('swift');
      const screenNames = result.screens.map((s) => s.name);
      expect(screenNames).toContain('LoginViewController');
      expect(screenNames).toContain('ProfileViewController');
      expect(result.screens.every((s) => s.type === 'viewcontroller')).toBe(true);
    });

    it('detects SwiftUI views', () => {
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'HomeView.swift', `
import SwiftUI
struct HomeView: View {
  var body: some View {
    Text("Hello")
  }
}
`);
      writeFile(tmpDir, 'SettingsView.swift', `
import SwiftUI
struct SettingsView: View {
  var body: some View {
    Text("Settings")
  }
}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      expect(result.framework).toBe('swift');
      const screenNames = result.screens.map((s) => s.name);
      expect(screenNames).toContain('HomeView');
      expect(screenNames).toContain('SettingsView');
      expect(result.screens.every((s) => s.type === 'swiftui-view')).toBe(true);
    });

    it('classifies mixed UIKit and SwiftUI correctly', () => {
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'OldScreen.swift', `
import UIKit
class OldScreen: UIViewController {}
`);
      writeFile(tmpDir, 'NewScreen.swift', `
import SwiftUI
struct NewScreen: View {
  var body: some View { Text("New") }
}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      const oldScreen = result.screens.find((s) => s.name === 'OldScreen');
      const newScreen = result.screens.find((s) => s.name === 'NewScreen');
      expect(oldScreen?.type).toBe('viewcontroller');
      expect(newScreen?.type).toBe('swiftui-view');
    });

    it('extracts SwiftUI tab-bar labels via Label() and Text()', () => {
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'MainTabView.swift', `
import SwiftUI
struct MainTabView: View {
  var body: some View {
    TabView {
      HomeView()
        .tabItem { Label("Home", systemImage: "house") }
      TransactionsView()
        .tabItem { Label("Transactions", systemImage: "list.bullet") }
      CardsView()
        .tabItem { Text("Cards") }
    }
  }
}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      const tabView = result.screens.find((s) => s.name === 'MainTabView');
      expect(tabView).toBeDefined();
      const texts = tabView!.elements.map((e) => e.text);
      expect(texts).toContain('Home');
      expect(texts).toContain('Transactions');
      expect(texts).toContain('Cards');
    });

    it('extracts navigationTitle and form control labels', () => {
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'SettingsView.swift', `
import SwiftUI
struct SettingsView: View {
  @State var notificationsOn = false
  var body: some View {
    Form {
      Toggle("Push Notifications", isOn: $notificationsOn)
      Picker("Theme", selection: .constant(0)) { Text("Light"); Text("Dark") }
    }
    .navigationTitle("Settings")
  }
}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      const view = result.screens.find((s) => s.name === 'SettingsView')!;
      const texts = view.elements.map((e) => e.text);
      expect(texts).toContain('Settings');
      expect(texts).toContain('Push Notifications');
      expect(texts).toContain('Theme');
    });

    // Distinguishing real .accessibilityIdentifier(...) values from synthetic
    // text-derived ids is what stops the cold-launch gate validator from
    // emitting `tapOn: { id: "continue" }` against a button whose only real
    // selector is the text "Continue" — the silent-failure mode in the iOS
    // run from 2026-04-29.
    it('populates accessibilityId only for real .accessibilityIdentifier(...) values', () => {
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'WaitlistView.swift', `
import SwiftUI
struct WaitlistView: View {
  var body: some View {
    VStack {
      Button("Continue") { }
        .accessibilityIdentifier("continue_button")
      Button("Already have a code") { }
    }
  }
}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      const view = result.screens.find((s) => s.name === 'WaitlistView')!;
      const continueBtn = view.elements.find((e) => e.accessibilityId === 'continue_button');
      expect(continueBtn).toBeDefined();
      expect(continueBtn!.id).toBe('continue_button');

      const alreadyHaveCode = view.elements.find((e) => e.text === 'Already have a code');
      expect(alreadyHaveCode).toBeDefined();
      expect(alreadyHaveCode!.accessibilityId).toBeUndefined();
    });

    // Run from 2026-04-29 (Nola PR#8, run id 25113423485) had 100+ vendor
    // SDK swift files leaking from `ios/build/SourcePackages/checkouts/...`
    // (Firebase, Sentry, Privy, etc.). They overwhelmed the 60-screen prompt
    // slice and broke AI launch-state detection. This test pins the fix in
    // walkDir that excludes build/Pods/Carthage/DerivedData/vendor.
    it('skips vendor SDK files under build/SourcePackages and Pods (Nola PR#8 repro)', () => {
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      // Real app screens
      writeFile(tmpDir, 'app/HomeView.swift', `
import SwiftUI
struct HomeView: View { var body: some View { Text("Home") } }
`);
      writeFile(tmpDir, 'app/LanguageGateView.swift', `
import SwiftUI
struct LanguageGateView: View { var body: some View { Text("Choose your language") } }
`);
      // Vendor SDK noise — must NOT appear in the screens list
      writeFile(tmpDir, 'build/SourcePackages/checkouts/firebase-ios-sdk/FirebaseAuth/Sources/Swift/Auth/AuthDefaultUIDelegate.swift', `
import UIKit
class AuthDefaultUIDelegate: UIViewController {}
`);
      writeFile(tmpDir, 'build/SourcePackages/checkouts/firebase-ios-sdk/FirebaseAuth/Sources/Swift/MultiFactor/MFALoginView.swift', `
import SwiftUI
struct MFALoginView: View { var body: some View { Text("MFA") } }
`);
      writeFile(tmpDir, 'build/DerivedData/SourcePackages/checkouts/sentry-cocoa/SampleApp/AppDelegate.swift', `
import UIKit
class AppDelegate: UIViewController {}
`);
      writeFile(tmpDir, 'Pods/Firebase/Auth/AuthViewController.swift', `
import UIKit
class AuthViewController: UIViewController {}
`);
      writeFile(tmpDir, 'Carthage/Checkouts/SomeSDK/Sample.swift', `
import SwiftUI
struct SampleView: View { var body: some View { Text("Sample") } }
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();
      const names = result.screens.map((s) => s.name).sort();

      expect(names).toEqual(['HomeView', 'LanguageGateView']);
    });

    it('ignores non-screen Swift files', () => {
      writeFile(tmpDir, 'MyApp.xcodeproj/project.pbxproj', '');
      writeFile(tmpDir, 'NetworkManager.swift', `
import Foundation
class NetworkManager {
  func fetch() {}
}
`);
      writeFile(tmpDir, 'Constants.swift', `
let API_URL = "https://api.example.com"
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      expect(result.screens).toHaveLength(0);
    });
  });

  describe('Kotlin screen scanning', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = createTmpDir(); });
    afterEach(() => { cleanDir(tmpDir); });

    it('detects Activity classes', () => {
      writeFile(tmpDir, 'build.gradle', 'apply plugin: "com.android.application"\napply plugin: "kotlin-android"');
      writeFile(tmpDir, 'app/src/main/java/com/example/MainActivity.kt', `
package com.example
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
class MainActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState) }
}
`);
      writeFile(tmpDir, 'app/src/main/java/com/example/DetailActivity.kt', `
package com.example
import androidx.activity.ComponentActivity
class DetailActivity : ComponentActivity() {}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      expect(result.framework).toBe('kotlin');
      const activities = result.screens.filter((s) => s.type === 'activity');
      expect(activities.map((a) => a.name)).toContain('MainActivity');
      expect(activities.map((a) => a.name)).toContain('DetailActivity');
    });

    it('detects Fragment classes', () => {
      writeFile(tmpDir, 'build.gradle', 'apply plugin: "com.android.application"\napply plugin: "kotlin-android"');
      writeFile(tmpDir, 'app/src/main/java/com/example/HomeFragment.kt', `
package com.example
import androidx.fragment.app.Fragment
class HomeFragment : Fragment() {}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      const fragments = result.screens.filter((s) => s.type === 'fragment');
      expect(fragments.map((f) => f.name)).toContain('HomeFragment');
    });

    it('detects Composable screens', () => {
      writeFile(tmpDir, 'build.gradle.kts', `
plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
dependencies { implementation("androidx.compose.ui:ui:1.5.0") }
`);
      writeFile(tmpDir, 'app/src/main/kotlin/com/example/HomeScreen.kt', `
package com.example
import androidx.compose.runtime.Composable
@Composable
fun HomeScreen() {
  Text("Hello")
}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      const composables = result.screens.filter((s) => s.type === 'composable');
      expect(composables.map((c) => c.name)).toContain('HomeScreen');
    });

    it('does not duplicate screens when mobilePath overlaps search dirs', () => {
      writeFile(tmpDir, 'build.gradle', 'apply plugin: "com.android.application"\napply plugin: "kotlin-android"');
      writeFile(tmpDir, 'app/src/main/java/com/example/MainActivity.kt', `
package com.example
class MainActivity : AppCompatActivity() {}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      const mainActivities = result.screens.filter((s) => s.name === 'MainActivity');
      expect(mainActivities).toHaveLength(1);
    });

    it('ignores non-screen Kotlin files', () => {
      writeFile(tmpDir, 'build.gradle', 'apply plugin: "com.android.application"\napply plugin: "kotlin-android"');
      writeFile(tmpDir, 'app/src/main/java/com/example/ApiClient.kt', `
package com.example
class ApiClient {
  fun fetch() {}
}
`);

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      expect(result.screens).toHaveLength(0);
    });
  });

  describe('React Native screen scanning', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = createTmpDir(); });
    afterEach(() => { cleanDir(tmpDir); });

    it('detects React Native screens', () => {
      writeFile(tmpDir, 'package.json', JSON.stringify({
        dependencies: { 'react-native': '^0.72.0' },
      }));
      writeFile(tmpDir, 'src/screens/HomeScreen.tsx', 'export default function HomeScreen() {}');
      writeFile(tmpDir, 'src/screens/LoginScreen.tsx', 'export default function LoginScreen() {}');

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      expect(result.framework).toBe('react-native');
      expect(result.screens.map((s) => s.name)).toContain('HomeScreen');
      expect(result.screens.map((s) => s.name)).toContain('LoginScreen');
    });
  });

  describe('Flutter screen scanning', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = createTmpDir(); });
    afterEach(() => { cleanDir(tmpDir); });

    it('detects Flutter screens', () => {
      writeFile(tmpDir, 'pubspec.yaml', 'name: my_app\ndependencies:\n  flutter:\n    sdk: flutter\n');
      writeFile(tmpDir, 'lib/main.dart', 'void main() {}');
      writeFile(tmpDir, 'lib/screens/home_screen.dart', 'class HomeScreen extends StatelessWidget {}');

      const scanner = new RepoScanner(tmpDir);
      const result = scanner.scan();

      expect(result.framework).toBe('flutter');
      expect(result.screens.map((s) => s.name)).toContain('home_screen');
    });
  });
});
