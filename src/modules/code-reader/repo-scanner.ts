import * as fs from 'fs';
import * as path from 'path';
import { CodeAnalysis, Screen, ApiEndpoint } from '../../types';
import { FrameworkDetector } from './framework-detector';
import { Logger } from '../../utils/logger';

function slug(value: string): string {
  return value.replace(/\s+/g, '_').toLowerCase();
}

export class RepoScanner {
  private logger = new Logger('RepoScanner');
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  scan(diffFilePaths?: string[]): CodeAnalysis & { mobilePath: string } {
    const detector = new FrameworkDetector();
    let detection = detector.detect(this.rootPath);

    // Fallback: if filesystem scan found nothing, detect from PR diff file paths.
    // This handles repos being bootstrapped from scratch (all files are "added").
    if (detection.framework === 'native' && diffFilePaths && diffFilePaths.length > 0) {
      const fallback = detector.detectFromFilePaths(diffFilePaths, this.rootPath);
      if (fallback) {
        this.logger.log('Filesystem scan returned native/unknown — using diff-path detection', {
          framework: fallback.framework,
          mobilePath: fallback.mobilePath,
        });
        detection = fallback;
      }
    }

    const framework = detection.framework;
    const mobilePath = detection.mobilePath;
    const screens = this.scanScreens(framework, mobilePath);
    const apiEndpoints = this.scanApiEndpoints();

    this.logger.log('Repo scan complete', {
      framework,
      mobilePath,
      screenCount: screens.length,
      endpointCount: apiEndpoints.length,
    });

    // Detect minimum OS versions from project files
    const minIosVersion = this.detectMinIosVersion(mobilePath);
    const minAndroidVersion = this.detectMinAndroidVersion(mobilePath);

    return {
      framework,
      screens,
      apiEndpoints,
      industry: 'unknown',
      criticalFlows: [],
      mobilePath,
      minIosVersion,
      minAndroidVersion,
    };
  }

  private scanScreens(framework: string, mobilePath: string): Screen[] {
    if (framework === 'swift') return this.scanSwiftScreens(mobilePath);
    if (framework === 'kotlin') return this.scanKotlinScreens(mobilePath);

    const screens: Screen[] = [];
    let searchDir = '';
    let fileExt = '';

    if (framework === 'react-native') {
      searchDir = 'src/screens';
      fileExt = '.tsx';
    } else if (framework === 'flutter') {
      searchDir = 'lib/screens';
      fileExt = '.dart';
    }

    if (searchDir && fs.existsSync(path.join(mobilePath, searchDir))) {
      const files = this.walkDir(path.join(mobilePath, searchDir));
      files.forEach((file) => {
        if (file.endsWith(fileExt)) {
          let elements: { id: string; type: string; text?: string }[] = [];
          try {
            const content = fs.readFileSync(file, 'utf-8');
            elements =
              framework === 'react-native'
                ? this.extractJsxLabels(content)
                : this.extractFlutterLabels(content);
          } catch {
            /* ignore unreadable files */
          }
          screens.push({
            name: path.basename(file, fileExt),
            path: file,
            type: 'screen',
            elements,
          });
        }
      });
    }

    return screens;
  }

  // Extract labels from JSX/TSX sources for React Native screens. We don't try to be a
  // real parser — these are matched by regex on the textual source. The goal is to give
  // the resolver and ScenarioBrain a vocabulary of likely interactive labels even when
  // the codebase has zero testIDs.
  private extractJsxLabels(content: string): { id: string; type: string; text?: string }[] {
    const out: { id: string; type: string; text?: string }[] = [];
    const seen = new Set<string>();
    const add = (id: string, type: string, text?: string) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, type, text });
    };

    // testID="x"
    for (const m of content.matchAll(/testID\s*=\s*["']([^"']+)["']/g)) add(m[1], 'element');

    // accessibilityLabel="x"
    for (const m of content.matchAll(/accessibilityLabel\s*=\s*["']([^"']+)["']/g)) add(m[1], 'label');

    // <Button title="X" /> and <Button>X</Button>
    for (const m of content.matchAll(/<Button[^>]*title\s*=\s*["']([^"']+)["']/g))
      add(slug(m[1]), 'button', m[1]);
    for (const m of content.matchAll(/<Button[^>]*>([^<]+)<\/Button>/g))
      add(slug(m[1].trim()), 'button', m[1].trim());

    // <Text>...</Text> visible labels
    for (const m of content.matchAll(/<Text[^>]*>([^<{}\n][^<{}]*?)<\/Text>/g)) {
      const t = m[1].trim();
      if (t && t.length < 60) add(slug(t), 'text', t);
    }

    // <TextInput placeholder="X" />
    for (const m of content.matchAll(/<TextInput[^>]*placeholder\s*=\s*["']([^"']+)["']/g))
      add(slug(m[1]), 'textfield', m[1]);

    // <TouchableOpacity ... /> with onPress and an inner Text — capture the inner text
    for (const m of content.matchAll(/<TouchableOpacity[^>]*>\s*<Text[^>]*>([^<{}]+)<\/Text>/g)) {
      const t = m[1].trim();
      if (t && t.length < 60) add(slug(t), 'button', t);
    }

    return out;
  }

  // Kotlin / Jetpack Compose / View XML label extraction. Catches Compose Text/Button
  // composables, View setText calls, and contentDescription. Same regex caveats as
  // the JSX extractor — best-effort vocabulary, not a parser.
  private extractKotlinLabels(content: string): { id: string; type: string; text?: string }[] {
    const out: { id: string; type: string; text?: string }[] = [];
    const seen = new Set<string>();
    const add = (id: string, type: string, text?: string) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, type, text });
    };

    // Compose: Text("X")
    for (const m of content.matchAll(/\bText\s*\(\s*"([^"]+)"/g)) {
      const t = m[1];
      if (t.length < 60) add(slug(t), 'text', t);
    }
    // Compose: Text(text = "X") — keyword form
    for (const m of content.matchAll(/\bText\s*\(\s*text\s*=\s*"([^"]+)"/g)) {
      const t = m[1];
      if (t.length < 60) add(slug(t), 'text', t);
    }

    // Compose: Button(...) { Text("X") } — capture inner Text
    for (const m of content.matchAll(
      /\b(?:Button|OutlinedButton|TextButton|FloatingActionButton|IconButton)\s*\([^)]*\)\s*\{[\s\S]{0,200}?Text\s*\(\s*"([^"]+)"/g,
    )) {
      add(slug(m[1]), 'button', m[1]);
    }

    // Compose: TextField(label = { Text("X") }, ...)
    for (const m of content.matchAll(/label\s*=\s*\{\s*Text\s*\(\s*"([^"]+)"/g))
      add(slug(m[1]), 'textfield', m[1]);

    // View binding: button.text = "X" / button.setText("X")
    for (const m of content.matchAll(/\.text\s*=\s*"([^"]+)"/g)) {
      const t = m[1];
      if (t.length < 60) add(slug(t), 'text', t);
    }
    for (const m of content.matchAll(/\.setText\s*\(\s*"([^"]+)"/g)) {
      const t = m[1];
      if (t.length < 60) add(slug(t), 'text', t);
    }

    // contentDescription
    for (const m of content.matchAll(/contentDescription\s*=\s*"([^"]+)"/g))
      add(slug(m[1]), 'label', m[1]);

    return out;
  }

  // Flutter widget label extraction — Text("X"), ElevatedButton/TextButton(child: Text("X")),
  // TextField(decoration: InputDecoration(labelText: "X")). Regex-based, same caveats.
  private extractFlutterLabels(content: string): { id: string; type: string; text?: string }[] {
    const out: { id: string; type: string; text?: string }[] = [];
    const seen = new Set<string>();
    const add = (id: string, type: string, text?: string) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, type, text });
    };

    // Text("X")
    for (const m of content.matchAll(/\bText\s*\(\s*['"]([^'"]+)['"]/g)) {
      const t = m[1];
      if (t.length < 60) add(slug(t), 'text', t);
    }

    // ElevatedButton / TextButton / OutlinedButton with child: Text("X")
    for (const m of content.matchAll(
      /\b(?:ElevatedButton|TextButton|OutlinedButton|FilledButton|FloatingActionButton)\b[\s\S]{0,200}?Text\s*\(\s*['"]([^'"]+)['"]/g,
    )) {
      add(slug(m[1]), 'button', m[1]);
    }

    // labelText / hintText for inputs
    for (const m of content.matchAll(/(?:labelText|hintText)\s*:\s*['"]([^'"]+)['"]/g))
      add(slug(m[1]), 'textfield', m[1]);

    // Semantics(label: 'X') — Flutter accessibility
    for (const m of content.matchAll(/Semantics\s*\([^)]*label\s*:\s*['"]([^'"]+)['"]/g))
      add(slug(m[1]), 'label', m[1]);

    return out;
  }

  private scanSwiftScreens(mobilePath: string): Screen[] {
    const screens: Screen[] = [];
    const files = this.walkDir(mobilePath).filter((f) => f.endsWith('.swift'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const name = path.basename(file, '.swift');
        let type: 'activity' | 'fragment' | 'viewcontroller' | 'screen' | 'composable' | 'swiftui-view' | null = null;

        if (content.includes('UIViewController') || content.includes('UITableViewController') || content.includes('UICollectionViewController')) {
          type = 'viewcontroller';
        } else if ((content.includes('import SwiftUI') || content.includes('SwiftUI')) && /struct\s+\w+\s*:\s*View/.test(content)) {
          type = 'swiftui-view';
        }

        if (type) {
          const elements = this.extractSwiftElements(content);
          screens.push({ name, path: file, type, elements });
        }
      } catch { /* ignore unreadable files */ }
    }

    return screens;
  }

  private extractSwiftElements(content: string): { id: string; type: string; text?: string; accessibilityId?: string }[] {
    const elements: { id: string; type: string; text?: string; accessibilityId?: string }[] = [];
    const seen = new Set<string>();

    const add = (id: string, type: string, text?: string, accessibilityId?: string) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        elements.push({ id, type, text, accessibilityId });
      }
    };

    // accessibilityIdentifier = "xxx" — UIKit. The captured value is an
    // authoritative, developer-set a11y ID. We mirror it into both `id` (for
    // legacy lookups) and `accessibilityId` (for downstream code that needs to
    // distinguish a real a11y ID from a synthetic slug derived from button text).
    for (const m of content.matchAll(/\.accessibilityIdentifier\s*=\s*["']([^"']+)["']/g)) add(m[1], 'element', undefined, m[1]);
    for (const m of content.matchAll(/accessibilityIdentifier:\s*["']([^"']+)["']/g)) add(m[1], 'element', undefined, m[1]);

    // .accessibilityIdentifier("xxx") — SwiftUI
    for (const m of content.matchAll(/\.accessibilityIdentifier\s*\(\s*["']([^"']+)["']\s*\)/g)) add(m[1], 'element', undefined, m[1]);

    // accessibilityLabel = "xxx"
    for (const m of content.matchAll(/\.accessibilityLabel\s*=\s*["']([^"']+)["']/g)) add(m[1], 'label');
    for (const m of content.matchAll(/\.accessibilityLabel\s*\(\s*["']([^"']+)["']\s*\)/g)) add(m[1], 'label');

    // IBOutlet / @IBOutlet weak var nameHere: UIButton
    for (const m of content.matchAll(/@IBOutlet\s+(?:weak\s+)?var\s+(\w+)\s*:\s*(UI\w+)/g)) add(m[1], m[2]);

    // Button titles: setTitle("xxx") or Button("xxx")
    for (const m of content.matchAll(/setTitle\s*\(\s*["']([^"']+)["']/g)) add(m[1].replace(/\s+/g, '_').toLowerCase(), 'button', m[1]);
    for (const m of content.matchAll(/Button\s*\(\s*["']([^"']+)["']/g)) add(m[1].replace(/\s+/g, '_').toLowerCase(), 'button', m[1]);

    // TextField/SecureField placeholders: TextField("placeholder", ...)
    for (const m of content.matchAll(/(?:TextField|SecureField)\s*\(\s*["']([^"']+)["']/g)) add(m[1].replace(/\s+/g, '_').toLowerCase(), 'textfield', m[1]);

    // SwiftUI Text("xxx") — covers static labels including .tabItem { Text("Home") }
    for (const m of content.matchAll(/\bText\s*\(\s*["']([^"']+)["']/g)) {
      if (m[1].length < 60) add(m[1].replace(/\s+/g, '_').toLowerCase(), 'text', m[1]);
    }

    // SwiftUI Label("xxx", systemImage: ...) / Label("xxx", image: ...) — typical tab bar items
    for (const m of content.matchAll(/\bLabel\s*\(\s*["']([^"']+)["']\s*,\s*(?:systemImage|image)\s*:/g)) {
      if (m[1].length < 60) add(m[1].replace(/\s+/g, '_').toLowerCase(), 'label', m[1]);
    }

    // SwiftUI screen titles: .navigationTitle("xxx") / .navigationBarTitle("xxx")
    for (const m of content.matchAll(/\.navigation(?:Bar)?Title\s*\(\s*["']([^"']+)["']/g)) {
      if (m[1].length < 60) add(m[1].replace(/\s+/g, '_').toLowerCase(), 'title', m[1]);
    }

    // SwiftUI form controls: Toggle("xxx", ...), Picker("xxx", ...), Stepper("xxx", ...)
    for (const m of content.matchAll(/\b(?:Toggle|Picker|Stepper)\s*\(\s*["']([^"']+)["']/g)) {
      if (m[1].length < 60) add(m[1].replace(/\s+/g, '_').toLowerCase(), 'control', m[1]);
    }

    // UILabel.text = "xxx"
    for (const m of content.matchAll(/\.text\s*=\s*["']([^"']+)["']/g)) {
      if (m[1].length < 60) add(m[1].replace(/\s+/g, '_').toLowerCase(), 'label', m[1]);
    }

    return elements;
  }

  private scanKotlinScreens(mobilePath: string): Screen[] {
    const screens: Screen[] = [];
    const searchDirs = [
      path.join(mobilePath, 'app', 'src', 'main', 'java'),
      path.join(mobilePath, 'app', 'src', 'main', 'kotlin'),
      mobilePath,
    ];

    const seen = new Set<string>();
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = this.walkDir(dir).filter((f) => f.endsWith('.kt'));

      for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        try {
          const content = fs.readFileSync(file, 'utf-8');
          const name = path.basename(file, '.kt');

          if (/:\s*(AppCompat)?Activity\b/.test(content) || /:\s*ComponentActivity\b/.test(content)) {
            screens.push({ name, path: file, type: 'activity', elements: this.extractKotlinLabels(content) });
          } else if (/:\s*Fragment\b/.test(content)) {
            screens.push({ name, path: file, type: 'fragment', elements: this.extractKotlinLabels(content) });
          } else if (content.includes('@Composable')) {
            screens.push({ name, path: file, type: 'composable', elements: this.extractKotlinLabels(content) });
          }
        } catch { /* ignore unreadable files */ }
      }
    }

    return screens;
  }

  private scanApiEndpoints(): ApiEndpoint[] {
    const endpoints: ApiEndpoint[] = [];
    const apiFiles = this.walkDir(this.rootPath).filter((f) => f.includes('api') || f.includes('service'));

    apiFiles.forEach((file) => {
      if (
        !file.endsWith('.ts') &&
        !file.endsWith('.tsx') &&
        !file.endsWith('.dart') &&
        !file.endsWith('.swift') &&
        !file.endsWith('.kt')
      )
        return;
      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.match(/(?:get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi);
      if (matches) {
        matches.forEach((match) => {
          const method = match.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || 'GET';
          const path = match.match(/['"]([^'"]+)['"]/)?.[1] || '';
          endpoints.push({ method, path });
        });
      }
    });

    return endpoints;
  }

  private walkDir(dir: string): string[] {
    const files: string[] = [];
    try {
      fs.readdirSync(dir).forEach((file) => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          if (!file.includes('node_modules') && !file.startsWith('.') && !file.includes('dist')) {
            files.push(...this.walkDir(fullPath));
          }
        } else {
          files.push(fullPath);
        }
      });
    } catch {
      // ignore
    }
    return files;
  }

  private detectMinIosVersion(mobilePath: string): string | undefined {
    // Check pbxproj for IPHONEOS_DEPLOYMENT_TARGET
    const pbxproj = this.findInTree('project\\.pbxproj$', mobilePath);
    if (pbxproj) {
      try {
        const content = fs.readFileSync(pbxproj, 'utf-8');
        const match = content.match(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*([\d.]+)/);
        if (match) return match[1];
      } catch { /* ignore */ }
    }
    return undefined;
  }

  private detectMinAndroidVersion(mobilePath: string): string | undefined {
    // Check build.gradle for minSdkVersion
    const gradle = this.findInTree('build\\.gradle(\\.kts)?$', mobilePath);
    if (gradle) {
      try {
        const content = fs.readFileSync(gradle, 'utf-8');
        const match = content.match(/minSdk(?:Version)?\s*[=:]\s*(\d+)/);
        if (match) return match[1];
      } catch { /* ignore */ }
    }
    return undefined;
  }

  private findInTree(pattern: string, dir: string): string | null {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.match(pattern)) return path.join(dir, file);
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory() && !file.includes('node_modules')) {
          const found = this.findInTree(pattern, fullPath);
          if (found) return found;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }
}
