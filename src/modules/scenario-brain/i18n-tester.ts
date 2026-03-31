import * as fs from 'fs';
import * as path from 'path';
import { BddScenario, GherkinStep } from '../../types';
import { Logger } from '../../utils/logger';

interface LocaleInfo {
  code: string;
  name: string;
  isRtl: boolean;
  filePath: string;
  keyCount: number;
}

export class I18nTester {
  private logger = new Logger('I18nTester');

  private static readonly RTL_LOCALES = new Set([
    'ar',
    'he',
    'fa',
    'ur',
    'ps',
    'sd',
    'ckb',
    'yi',
    'arc',
    'dv',
    'ha',
    'khw',
    'ks',
    'ku',
  ]);

  private static readonly LOCALE_DISPLAY_NAMES: Record<string, string> = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
    ar: 'Arabic',
    he: 'Hebrew',
    hi: 'Hindi',
    ru: 'Russian',
    tr: 'Turkish',
    nl: 'Dutch',
    pl: 'Polish',
    th: 'Thai',
    vi: 'Vietnamese',
    id: 'Indonesian',
    fa: 'Persian',
    ur: 'Urdu',
    sv: 'Swedish',
    da: 'Danish',
    fi: 'Finnish',
    nb: 'Norwegian',
    cs: 'Czech',
    ro: 'Romanian',
    hu: 'Hungarian',
    uk: 'Ukrainian',
  };

  generateI18nTests(rootPath: string): BddScenario[] {
    const locales = this.discoverLocales(rootPath);

    if (locales.length === 0) {
      this.logger.log('No locale files found, generating generic i18n tests');
      return this.generateGenericI18nTests();
    }

    this.logger.log('Locales discovered', {
      count: locales.length,
      locales: locales.map((l) => l.code),
      rtlLocales: locales.filter((l) => l.isRtl).map((l) => l.code),
    });

    const scenarios: BddScenario[] = [];

    // Missing translation tests
    scenarios.push(...this.generateMissingTranslationTests(locales));
    // RTL layout tests
    scenarios.push(...this.generateRtlTests(locales));
    // Text expansion/truncation tests
    scenarios.push(...this.generateTextExpansionTests(locales));
    // Character encoding tests
    scenarios.push(...this.generateEncodingTests(locales));
    // Locale switching tests
    scenarios.push(...this.generateLocaleSwitchingTests(locales));
    // Date/number formatting tests
    scenarios.push(...this.generateFormattingTests(locales));

    this.logger.log('I18n tests generated', { total: scenarios.length });
    return scenarios;
  }

  private discoverLocales(rootPath: string): LocaleInfo[] {
    const locales: LocaleInfo[] = [];
    const seen = new Set<string>();

    // Android: res/values-<locale>/strings.xml
    this.discoverAndroidLocales(rootPath, locales, seen);
    // iOS: <locale>.lproj/Localizable.strings
    this.discoverIosLocales(rootPath, locales, seen);
    // JSON locale files (React Native, Flutter, generic)
    this.discoverJsonLocales(rootPath, locales, seen);
    // Flutter: lib/l10n/*.arb
    this.discoverArbLocales(rootPath, locales, seen);

    return locales;
  }

  private discoverAndroidLocales(rootPath: string, locales: LocaleInfo[], seen: Set<string>): void {
    const resDir = path.join(rootPath, 'android', 'app', 'src', 'main', 'res');
    if (!fs.existsSync(resDir)) return;

    try {
      const dirs = fs.readdirSync(resDir);
      for (const dir of dirs) {
        const match = dir.match(/^values-(\w{2}(?:-\w+)?)$/);
        if (!match) continue;

        const code = match[1].replace('-r', '-');
        const stringsFile = path.join(resDir, dir, 'strings.xml');
        if (!fs.existsSync(stringsFile) || seen.has(code)) continue;

        seen.add(code);
        const content = fs.readFileSync(stringsFile, 'utf-8');
        const keyCount = (content.match(/<string\s+name=/g) || []).length;

        locales.push({
          code,
          name: I18nTester.LOCALE_DISPLAY_NAMES[code.split('-')[0]] || code,
          isRtl: I18nTester.RTL_LOCALES.has(code.split('-')[0]),
          filePath: stringsFile,
          keyCount,
        });
      }
    } catch {
      // ignore
    }

    // Check default strings.xml
    const defaultStrings = path.join(resDir, 'values', 'strings.xml');
    if (fs.existsSync(defaultStrings) && !seen.has('en')) {
      seen.add('en');
      const content = fs.readFileSync(defaultStrings, 'utf-8');
      const keyCount = (content.match(/<string\s+name=/g) || []).length;
      locales.push({
        code: 'en',
        name: 'English',
        isRtl: false,
        filePath: defaultStrings,
        keyCount,
      });
    }
  }

  private discoverIosLocales(rootPath: string, locales: LocaleInfo[], seen: Set<string>): void {
    const searchDirs = [rootPath, path.join(rootPath, 'ios')];

    for (const searchDir of searchDirs) {
      if (!fs.existsSync(searchDir)) continue;

      try {
        const entries = fs.readdirSync(searchDir);
        for (const entry of entries) {
          const match = entry.match(/^(\w{2}(?:-\w+)?)\.lproj$/);
          if (!match) continue;

          const code = match[1];
          const localizableFile = path.join(searchDir, entry, 'Localizable.strings');
          if (!fs.existsSync(localizableFile) || seen.has(code)) continue;

          seen.add(code);
          const content = fs.readFileSync(localizableFile, 'utf-8');
          const keyCount = (content.match(/"\s*=\s*"/g) || []).length;

          locales.push({
            code,
            name: I18nTester.LOCALE_DISPLAY_NAMES[code.split('-')[0]] || code,
            isRtl: I18nTester.RTL_LOCALES.has(code.split('-')[0]),
            filePath: localizableFile,
            keyCount,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  private discoverJsonLocales(rootPath: string, locales: LocaleInfo[], seen: Set<string>): void {
    const localeDirs = [
      path.join(rootPath, 'src', 'locales'),
      path.join(rootPath, 'src', 'i18n'),
      path.join(rootPath, 'src', 'translations'),
      path.join(rootPath, 'locales'),
      path.join(rootPath, 'i18n'),
      path.join(rootPath, 'translations'),
      path.join(rootPath, 'assets', 'locales'),
      path.join(rootPath, 'assets', 'translations'),
    ];

    for (const dir of localeDirs) {
      if (!fs.existsSync(dir)) continue;

      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const code = file.replace('.json', '');
          if (seen.has(code) || code.length > 5) continue;

          const filePath = path.join(dir, file);
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const keyCount = this.countJsonKeys(content);

            seen.add(code);
            locales.push({
              code,
              name: I18nTester.LOCALE_DISPLAY_NAMES[code.split('-')[0]] || code,
              isRtl: I18nTester.RTL_LOCALES.has(code.split('-')[0]),
              filePath,
              keyCount,
            });
          } catch {
            // invalid JSON
          }
        }
      } catch {
        // ignore
      }
    }
  }

  private discoverArbLocales(rootPath: string, locales: LocaleInfo[], seen: Set<string>): void {
    const l10nDir = path.join(rootPath, 'lib', 'l10n');
    if (!fs.existsSync(l10nDir)) return;

    try {
      const files = fs.readdirSync(l10nDir);
      for (const file of files) {
        if (!file.endsWith('.arb')) continue;
        const match = file.match(/app_(\w{2}(?:_\w+)?)\.arb$/);
        if (!match) continue;

        const code = match[1].replace('_', '-');
        if (seen.has(code)) continue;

        const filePath = path.join(l10nDir, file);
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const keyCount = Object.keys(content).filter((k) => !k.startsWith('@')).length;

          seen.add(code);
          locales.push({
            code,
            name: I18nTester.LOCALE_DISPLAY_NAMES[code.split('-')[0]] || code,
            isRtl: I18nTester.RTL_LOCALES.has(code.split('-')[0]),
            filePath,
            keyCount,
          });
        } catch {
          // invalid JSON
        }
      }
    } catch {
      // ignore
    }
  }

  private countJsonKeys(obj: unknown, depth = 0): number {
    if (depth > 5 || typeof obj !== 'object' || obj === null) return 0;
    let count = 0;
    for (const value of Object.values(obj)) {
      if (typeof value === 'string') count++;
      else if (typeof value === 'object') count += this.countJsonKeys(value, depth + 1);
    }
    return count;
  }

  private generateMissingTranslationTests(locales: LocaleInfo[]): BddScenario[] {
    if (locales.length < 2) return [];
    const feature = 'i18n - Missing Translations';
    const baseLocale = locales.find((l) => l.code === 'en') || locales[0];

    return locales
      .filter((l) => l.code !== baseLocale.code)
      .map((locale) =>
        this.scenario(feature, `All ${baseLocale.code} keys exist in ${locale.name} (${locale.code})`, [
          { keyword: 'Given', text: `the app has ${baseLocale.keyCount} translation keys in ${baseLocale.name}` },
          { keyword: 'When', text: `the locale is set to ${locale.name} (${locale.code})` },
          { keyword: 'Then', text: 'all translation keys should have a corresponding translation' },
          { keyword: 'And', text: 'no untranslated strings or fallback keys should be visible in the UI' },
        ]),
      );
  }

  private generateRtlTests(locales: LocaleInfo[]): BddScenario[] {
    const rtlLocales = locales.filter((l) => l.isRtl);
    if (rtlLocales.length === 0) return [];

    const feature = 'i18n - RTL Layout';
    const scenarios: BddScenario[] = [];

    for (const locale of rtlLocales) {
      scenarios.push(
        this.scenario(feature, `RTL layout renders correctly in ${locale.name}`, [
          { keyword: 'Given', text: `the device locale is set to ${locale.name} (${locale.code})` },
          { keyword: 'When', text: 'the app is launched' },
          { keyword: 'Then', text: 'the layout direction should be right-to-left' },
          { keyword: 'And', text: 'text alignment should be right-aligned' },
          { keyword: 'And', text: 'navigation icons and arrows should be mirrored' },
        ]),
      );

      scenarios.push(
        this.scenario(feature, `RTL text input works in ${locale.name}`, [
          { keyword: 'Given', text: `the device locale is set to ${locale.name} (${locale.code})` },
          { keyword: 'When', text: 'the user taps on a text input field' },
          { keyword: 'And', text: `the user types text in ${locale.name}` },
          { keyword: 'Then', text: 'the cursor should move from right to left' },
          { keyword: 'And', text: 'text should be properly aligned within the input field' },
        ]),
      );

      scenarios.push(
        this.scenario(feature, `Mixed LTR/RTL content in ${locale.name}`, [
          { keyword: 'Given', text: `the device locale is set to ${locale.name} (${locale.code})` },
          { keyword: 'When', text: 'a screen contains both RTL text and LTR content like numbers or English words' },
          { keyword: 'Then', text: 'bidirectional text should render correctly without overlapping' },
        ]),
      );
    }

    return scenarios;
  }

  private generateTextExpansionTests(locales: LocaleInfo[]): BddScenario[] {
    const feature = 'i18n - Text Expansion';
    const scenarios: BddScenario[] = [];

    // German and Finnish typically expand ~30% from English
    const expandingLocales = locales.filter((l) =>
      ['de', 'fi', 'ru', 'fr', 'es', 'pt', 'it'].includes(l.code.split('-')[0]),
    );

    // CJK languages typically contract
    const contractingLocales = locales.filter((l) => ['ja', 'ko', 'zh'].includes(l.code.split('-')[0]));

    for (const locale of expandingLocales) {
      scenarios.push(
        this.scenario(feature, `Text expansion does not break layout in ${locale.name}`, [
          { keyword: 'Given', text: `the device locale is set to ${locale.name} (${locale.code})` },
          { keyword: 'When', text: 'the user navigates through all main screens' },
          { keyword: 'Then', text: 'no text should be truncated without an ellipsis' },
          { keyword: 'And', text: 'buttons should not overflow their containers' },
          { keyword: 'And', text: 'no text should overlap with adjacent elements' },
        ]),
      );
    }

    for (const locale of contractingLocales) {
      scenarios.push(
        this.scenario(feature, `Contracted text alignment in ${locale.name}`, [
          { keyword: 'Given', text: `the device locale is set to ${locale.name} (${locale.code})` },
          { keyword: 'When', text: 'the user navigates through all main screens' },
          { keyword: 'Then', text: 'shorter text should be properly aligned within containers' },
          { keyword: 'And', text: 'no excessive whitespace should appear in the layout' },
        ]),
      );
    }

    return scenarios;
  }

  private generateEncodingTests(locales: LocaleInfo[]): BddScenario[] {
    const feature = 'i18n - Character Encoding';
    const scenarios: BddScenario[] = [];

    const specialCharLocales = locales.filter((l) =>
      ['ja', 'ko', 'zh', 'th', 'hi', 'ar', 'he', 'ru', 'uk'].includes(l.code.split('-')[0]),
    );

    for (const locale of specialCharLocales) {
      scenarios.push(
        this.scenario(feature, `${locale.name} characters render without mojibake`, [
          { keyword: 'Given', text: `the device locale is set to ${locale.name} (${locale.code})` },
          { keyword: 'When', text: 'the app displays translated text' },
          { keyword: 'Then', text: 'all characters should render correctly without replacement characters' },
          { keyword: 'And', text: 'no question marks or boxes should appear in place of text' },
        ]),
      );
    }

    return scenarios;
  }

  private generateLocaleSwitchingTests(locales: LocaleInfo[]): BddScenario[] {
    if (locales.length < 2) return [];
    const feature = 'i18n - Locale Switching';
    const locale1 = locales[0];
    const locale2 = locales.find((l) => l.code !== locale1.code) || locales[1];

    return [
      this.scenario(feature, `Switch locale from ${locale1.name} to ${locale2.name} at runtime`, [
        { keyword: 'Given', text: `the app is running with locale ${locale1.name} (${locale1.code})` },
        { keyword: 'When', text: `the user changes the device locale to ${locale2.name} (${locale2.code})` },
        { keyword: 'And', text: 'the user returns to the app' },
        { keyword: 'Then', text: `all text should update to ${locale2.name}` },
        { keyword: 'And', text: 'the app should not crash or show mixed-language content' },
      ]),
      this.scenario(feature, 'Locale change preserves user session', [
        { keyword: 'Given', text: 'the user is logged in and has active session data' },
        { keyword: 'When', text: `the device locale changes from ${locale1.name} to ${locale2.name}` },
        { keyword: 'Then', text: 'the user should remain logged in' },
        { keyword: 'And', text: 'all user data should be preserved' },
      ]),
    ];
  }

  private generateFormattingTests(locales: LocaleInfo[]): BddScenario[] {
    const feature = 'i18n - Date/Number Formatting';
    return locales.slice(0, 5).map((locale) =>
      this.scenario(feature, `Date and number formatting in ${locale.name}`, [
        { keyword: 'Given', text: `the device locale is set to ${locale.name} (${locale.code})` },
        { keyword: 'When', text: 'the app displays dates, times, and numbers' },
        { keyword: 'Then', text: `dates should follow ${locale.name} formatting conventions` },
        { keyword: 'And', text: `numbers should use the correct decimal and thousands separators for ${locale.name}` },
        { keyword: 'And', text: `currency should display in the correct format for ${locale.name}` },
      ]),
    );
  }

  private generateGenericI18nTests(): BddScenario[] {
    const feature = 'i18n - Generic';
    return [
      this.scenario(feature, 'App handles device locale change gracefully', [
        { keyword: 'Given', text: 'the app is running' },
        { keyword: 'When', text: 'the device locale is changed to a different language' },
        { keyword: 'Then', text: 'the app should not crash' },
      ]),
      this.scenario(feature, 'Unicode input handling', [
        { keyword: 'Given', text: 'the user is on a screen with text input' },
        { keyword: 'When', text: 'the user enters text with unicode characters, emojis, and special symbols' },
        { keyword: 'Then', text: 'the text should be accepted and displayed correctly' },
      ]),
    ];
  }

  private scenario(feature: string, scenario: string, steps: GherkinStep[]): BddScenario {
    return { feature, scenario, steps };
  }
}
