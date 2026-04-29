import * as fs from 'fs';
import * as path from 'path';
import { CodeAnalysis } from '../../types';

// Resolve the app's package id / bundle id at flow-generation time. ScenarioBrain
// needs this BEFORE asking the AI to author flows so the appId travels along
// with the YAML config block. Order of resolution: explicit env override →
// AndroidManifest scan → Info.plist scan → build.gradle applicationId →
// pbxproj PRODUCT_BUNDLE_IDENTIFIER. Returns whatever it can find; callers
// decide how to handle a missing platform.
export function resolveAppId(
  framework: CodeAnalysis['framework'] | undefined,
  mobilePath: string | undefined,
): { android?: string; ios?: string } {
  // framework is currently unused — the resolver scans both platforms regardless,
  // since RN/Flutter projects need both. Kept in the signature for future
  // platform-specific overrides.
  void framework;
  const out: { android?: string; ios?: string } = {};

  const envAndroid = process.env.MAESTRO_ANDROID_APP_ID;
  const envIos = process.env.MAESTRO_IOS_APP_ID;
  if (envAndroid) out.android = envAndroid;
  if (envIos) out.ios = envIos;

  if (!mobilePath) return out;

  if (!out.android) {
    const candidates = [
      'android/app/build.gradle',
      'android/app/build.gradle.kts',
      'app/build.gradle',
      'app/build.gradle.kts',
      'build.gradle',
      'build.gradle.kts',
    ];
    for (const rel of candidates) {
      const full = path.join(mobilePath, rel);
      if (!fs.existsSync(full)) continue;
      try {
        const src = fs.readFileSync(full, 'utf-8');
        const m =
          src.match(/applicationId\s*[=]?\s*["']([^"']+)["']/) ||
          src.match(/namespace\s*[=]?\s*["']([^"']+)["']/);
        if (m) {
          out.android = m[1];
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!out.ios) {
    const walk = (dir: string, depth = 0): string | null => {
      if (depth > 4) return null;
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return null;
      }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === 'Pods' || entry === 'build' || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          const found = walk(full, depth + 1);
          if (found) return found;
        } else if (entry === 'Info.plist') {
          try {
            const src = fs.readFileSync(full, 'utf-8');
            const m = src.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
            if (m && !m[1].includes('$(') && !m[1].includes('PRODUCT_BUNDLE_IDENTIFIER')) return m[1];
          } catch {
            /* ignore */
          }
        }
      }
      return null;
    };
    const found = walk(mobilePath);
    if (found) out.ios = found;
  }

  if (!out.ios) {
    const pbxFiles: string[] = [];
    const findPbx = (dir: string, depth = 0): void => {
      if (depth > 4) return;
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === 'Pods' || entry === 'build' || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) findPbx(full, depth + 1);
        else if (entry === 'project.pbxproj') pbxFiles.push(full);
      }
    };
    findPbx(mobilePath);
    for (const pbx of pbxFiles) {
      try {
        const src = fs.readFileSync(pbx, 'utf-8');
        const m = src.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\s]+)/);
        if (m && !m[1].includes('$(')) {
          out.ios = m[1].replace(/['"]/g, '');
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}
