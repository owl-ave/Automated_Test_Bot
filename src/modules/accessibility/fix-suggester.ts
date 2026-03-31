import { Logger } from '../../utils/logger';
import { ClaudeClient } from '../../ai/claude-client';
import { AccessibilityIssue } from './android-a11y';

export interface AccessibilityFix {
  issue: string;
  suggestedCode: string;
  fileToModify: string;
  framework: string;
  platform: 'android' | 'ios';
}

export class AccessibilityFixSuggester {
  private logger = new Logger('A11yFixSuggester');
  private claude: ClaudeClient;

  constructor() {
    this.claude = new ClaudeClient();
  }

  async suggestFixes(issues: AccessibilityIssue[], framework: string): Promise<AccessibilityFix[]> {
    if (issues.length === 0) return [];

    const fixes: AccessibilityFix[] = [];

    // Group issues by type to batch AI requests
    const grouped = this.groupIssues(issues);

    for (const [type, typeIssues] of Object.entries(grouped)) {
      try {
        const batchFixes = await this.generateFixesForGroup(type, typeIssues, framework);
        fixes.push(...batchFixes);
      } catch (err) {
        this.logger.error(`Failed to generate fixes for ${type}`, err);
        // Fall back to template-based fixes
        fixes.push(...this.getTemplateFixes(typeIssues, framework));
      }
    }

    this.logger.log('Fix suggestions generated', { fixCount: fixes.length });
    return fixes;
  }

  private groupIssues(issues: AccessibilityIssue[]): Record<string, AccessibilityIssue[]> {
    const grouped: Record<string, AccessibilityIssue[]> = {};
    for (const issue of issues) {
      const key = `${issue.platform}-${issue.type}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(issue);
    }
    return grouped;
  }

  private async generateFixesForGroup(
    type: string,
    issues: AccessibilityIssue[],
    framework: string,
  ): Promise<AccessibilityFix[]> {
    const issueDescriptions = issues
      .slice(0, 10) // Limit to avoid huge prompts
      .map((i, idx) => `${idx + 1}. [${i.severity}] ${i.message} (element: ${i.element})`)
      .join('\n');

    const prompt = `You are a mobile accessibility expert. Generate code fixes for the following accessibility issues in a ${framework} app.

Framework: ${framework}
Issues:
${issueDescriptions}

For each issue, provide:
1. A brief description of the fix
2. The exact code snippet to add/modify
3. The likely file path pattern where this fix should be applied

Respond in JSON format:
[
  {
    "issue": "description",
    "suggestedCode": "code snippet",
    "fileToModify": "file path pattern"
  }
]

Use ${this.getLanguageForFramework(framework)} syntax. Keep fixes minimal and correct.`;

    const response = await this.claude.analyzeCode('', prompt);
    const platform = issues[0]?.platform || 'android';

    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return this.getTemplateFixes(issues, framework);

      const parsed: Array<{ issue: string; suggestedCode: string; fileToModify: string }> = JSON.parse(jsonMatch[0]);
      return parsed.map((fix) => ({
        ...fix,
        framework,
        platform,
      }));
    } catch {
      return this.getTemplateFixes(issues, framework);
    }
  }

  private getLanguageForFramework(framework: string): string {
    switch (framework) {
      case 'react-native':
        return 'TypeScript/JSX';
      case 'flutter':
        return 'Dart';
      case 'swift':
        return 'Swift';
      case 'kotlin':
        return 'Kotlin';
      default:
        return 'the appropriate language';
    }
  }

  private getTemplateFixes(issues: AccessibilityIssue[], framework: string): AccessibilityFix[] {
    return issues.map((issue) => {
      const fix = this.getTemplateForIssue(issue, framework);
      return {
        issue: issue.message,
        suggestedCode: fix.code,
        fileToModify: fix.file,
        framework,
        platform: issue.platform,
      };
    });
  }

  private getTemplateForIssue(issue: AccessibilityIssue, framework: string): { code: string; file: string } {
    const templates: Record<string, Record<string, { code: string; file: string }>> = {
      'react-native': {
        'missing-label': {
          code: `<TouchableOpacity accessible={true} accessibilityLabel="Descriptive label">\n  {/* content */}\n</TouchableOpacity>`,
          file: 'src/components/*.tsx',
        },
        'missing-description': {
          code: `<Image accessible={true} accessibilityLabel="Description of image" />`,
          file: 'src/components/*.tsx',
        },
        'small-target': {
          code: `<TouchableOpacity style={{ minWidth: 48, minHeight: 48, padding: 12 }}>\n  {/* content */}\n</TouchableOpacity>`,
          file: 'src/components/*.tsx',
        },
        'low-contrast': {
          code: `// Ensure text color has >= 4.5:1 contrast ratio against background\n<Text style={{ color: '#1a1a1a' }}>{text}</Text>`,
          file: 'src/styles/*.ts',
        },
        'focus-order': {
          code: `<View accessible={true} accessibilityElementsHidden={false}>\n  {/* Ensure logical reading order */}\n</View>`,
          file: 'src/components/*.tsx',
        },
      },
      kotlin: {
        'missing-label': {
          code: `android:contentDescription="@string/descriptive_label"`,
          file: 'res/layout/*.xml',
        },
        'missing-description': {
          code: `imageView.contentDescription = getString(R.string.image_description)`,
          file: 'src/main/java/**/*.kt',
        },
        'small-target': {
          code: `android:minWidth="48dp"\nandroid:minHeight="48dp"`,
          file: 'res/layout/*.xml',
        },
        'low-contrast': {
          code: `<!-- Use a color with sufficient contrast -->\nandroid:textColor="@color/high_contrast_text"`,
          file: 'res/layout/*.xml',
        },
        'focus-order': {
          code: `android:accessibilityTraversalAfter="@id/previous_element"\nandroid:accessibilityTraversalBefore="@id/next_element"`,
          file: 'res/layout/*.xml',
        },
      },
      swift: {
        'missing-label': {
          code: `button.accessibilityLabel = "Descriptive label"\nbutton.isAccessibilityElement = true`,
          file: '*.swift',
        },
        'missing-description': {
          code: `imageView.accessibilityLabel = "Description of image"\nimageView.isAccessibilityElement = true`,
          file: '*.swift',
        },
        'small-target': {
          code: `// Override point(inside:with:) or increase frame\nbutton.frame = CGRect(x: 0, y: 0, width: max(frame.width, 44), height: max(frame.height, 44))`,
          file: '*.swift',
        },
        'low-contrast': {
          code: `label.textColor = UIColor.label // Uses system color with proper contrast`,
          file: '*.swift',
        },
        'focus-order': {
          code: `view.accessibilityElements = [firstElement, secondElement, thirdElement]`,
          file: '*.swift',
        },
      },
      flutter: {
        'missing-label': {
          code: `Semantics(\n  label: 'Descriptive label',\n  child: GestureDetector(...),\n)`,
          file: 'lib/**/*.dart',
        },
        'missing-description': {
          code: `Image.asset('image.png', semanticLabel: 'Description of image')`,
          file: 'lib/**/*.dart',
        },
        'small-target': {
          code: `SizedBox(\n  width: 48,\n  height: 48,\n  child: InkWell(...),\n)`,
          file: 'lib/**/*.dart',
        },
        'low-contrast': {
          code: `Text('content', style: TextStyle(color: Colors.black87)) // Ensure contrast >= 4.5:1`,
          file: 'lib/**/*.dart',
        },
        'focus-order': {
          code: `FocusTraversalGroup(\n  policy: OrderedTraversalPolicy(),\n  child: Column(children: [...]),\n)`,
          file: 'lib/**/*.dart',
        },
      },
    };

    const frameworkTemplates = templates[framework] || templates['react-native'];
    return (
      frameworkTemplates[issue.type] || {
        code: `// Fix ${issue.type}: ${issue.suggestion}`,
        file: 'src/**/*',
      }
    );
  }
}
