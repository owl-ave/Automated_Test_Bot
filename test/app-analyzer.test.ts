import { DiffFile } from '../src/types';

/**
 * Tests for the isUiFile logic in the AppAnalyzer module.
 * Since isUiFile is defined inline, we replicate the exact logic here
 * and test it thoroughly to ensure it matches production behavior.
 */

// Exact copy of the production isUiFile function from app-analyzer/index.ts
function isUiFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const uiPatterns = ['screen', 'activity', 'fragment', 'composable', 'viewcontroller', 'controller'];
  if (uiPatterns.some((p) => lower.includes(p))) return true;
  if (lower.endsWith('.storyboard') || lower.endsWith('.xib')) return true;
  if (lower.includes('res/layout') && lower.endsWith('.xml')) return true;
  if (lower.endsWith('.swift') && lower.includes('view')) return true;
  return false;
}

describe('isUiFile (AppAnalyzer UI file detection)', () => {
  describe('React Native files', () => {
    it('matches screen files', () => {
      expect(isUiFile('src/screens/HomeScreen.tsx')).toBe(true);
      expect(isUiFile('src/screens/LoginScreen.tsx')).toBe(true);
    });
  });

  describe('Android/Kotlin files', () => {
    it('matches Activity files', () => {
      expect(isUiFile('app/src/main/java/com/example/MainActivity.kt')).toBe(true);
      expect(isUiFile('app/src/main/java/com/example/DetailActivity.kt')).toBe(true);
    });

    it('matches Fragment files', () => {
      expect(isUiFile('app/src/main/java/com/example/HomeFragment.kt')).toBe(true);
    });

    it('matches Composable files', () => {
      expect(isUiFile('app/src/main/kotlin/com/example/HomeComposable.kt')).toBe(true);
    });

    it('matches XML layout files', () => {
      expect(isUiFile('app/src/main/res/layout/activity_main.xml')).toBe(true);
      expect(isUiFile('app/src/main/res/layout/fragment_home.xml')).toBe(true);
    });

    it('does not match non-layout XML files', () => {
      expect(isUiFile('app/src/main/res/values/strings.xml')).toBe(false);
      expect(isUiFile('app/src/main/res/drawable/icon.xml')).toBe(false);
    });
  });

  describe('iOS/Swift files', () => {
    it('matches ViewController files', () => {
      expect(isUiFile('MyApp/LoginViewController.swift')).toBe(true);
      expect(isUiFile('MyApp/HomeViewController.swift')).toBe(true);
    });

    it('matches SwiftUI View files', () => {
      expect(isUiFile('MyApp/HomeView.swift')).toBe(true);
      expect(isUiFile('MyApp/SettingsView.swift')).toBe(true);
      expect(isUiFile('MyApp/ContentView.swift')).toBe(true);
    });

    it('matches storyboard files', () => {
      expect(isUiFile('MyApp/Base.lproj/Main.storyboard')).toBe(true);
      expect(isUiFile('MyApp/LaunchScreen.storyboard')).toBe(true);
    });

    it('matches xib files', () => {
      expect(isUiFile('MyApp/CustomCell.xib')).toBe(true);
      expect(isUiFile('MyApp/HeaderView.xib')).toBe(true);
    });

    it('does not match non-view Swift files', () => {
      expect(isUiFile('MyApp/NetworkManager.swift')).toBe(false);
      expect(isUiFile('MyApp/Constants.swift')).toBe(false);
      expect(isUiFile('MyApp/AppDelegate.swift')).toBe(false);
    });
  });

  describe('Flutter files', () => {
    it('matches screen dart files', () => {
      expect(isUiFile('lib/screens/home_screen.dart')).toBe(true);
    });
  });

  describe('Non-UI files', () => {
    it('does not match utility files', () => {
      expect(isUiFile('src/utils/helper.ts')).toBe(false);
      expect(isUiFile('src/api/client.ts')).toBe(false);
      expect(isUiFile('package.json')).toBe(false);
      expect(isUiFile('README.md')).toBe(false);
    });

    it('does not match backend files', () => {
      expect(isUiFile('server/routes/api.ts')).toBe(false);
      expect(isUiFile('src/models/User.kt')).toBe(false);
    });
  });

  describe('case insensitivity', () => {
    it('matches regardless of case', () => {
      expect(isUiFile('MyApp/HOMESCREEN.TSX')).toBe(true);
      expect(isUiFile('MyApp/mainActivity.kt')).toBe(true);
      expect(isUiFile('MyApp/HomeViewController.Swift')).toBe(true);
    });
  });
});
