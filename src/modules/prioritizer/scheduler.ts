import { BddScenario, DiffFile } from '../../types';
import { Logger } from '../../utils/logger';

interface SchedulerOptions {
  failFast?: boolean;
  platformSpecific?: boolean;
}

const ANDROID_EXTENSIONS = ['.kt', '.java', '.xml'];
const IOS_EXTENSIONS = ['.swift', '.m', '.mm', '.xib', '.storyboard', '.plist'];
const ANDROID_PATHS = ['android/', 'app/src/main/', 'kotlin/', 'java/'];
const IOS_PATHS = ['ios/', 'Pods/', 'xcodeproj/', 'xcworkspace/'];

export class TestScheduler {
  private logger = new Logger('TestScheduler');
  private options: SchedulerOptions;

  constructor(options: SchedulerOptions = {}) {
    this.options = { failFast: true, platformSpecific: true, ...options };
  }

  prioritize(scenarios: BddScenario[], scores: Map<string, number>, diffFiles?: DiffFile[]): BddScenario[] {
    let ordered = [...scenarios];

    if (this.options.platformSpecific && diffFiles) {
      ordered = this.applyPlatformFilter(ordered, diffFiles);
    }

    ordered.sort((a, b) => {
      const scoreA = scores.get(a.scenario) ?? 50;
      const scoreB = scores.get(b.scenario) ?? 50;
      return scoreB - scoreA;
    });

    this.logger.log(`Prioritized ${ordered.length} scenarios`, {
      top3: ordered.slice(0, 3).map((s) => ({
        scenario: s.scenario,
        score: scores.get(s.scenario) ?? 0,
      })),
    });

    return ordered;
  }

  shouldCancelRemaining(
    completedResults: Array<{ scenario: string; status: 'pass' | 'fail' | 'warn' }>,
    scores: Map<string, number>,
  ): boolean {
    if (!this.options.failFast) return false;

    const criticalFailure = completedResults.some((r) => {
      const score = scores.get(r.scenario) ?? 0;
      return r.status === 'fail' && score >= 80;
    });

    if (criticalFailure) {
      this.logger.warn('Critical test failed — recommending cancel of low-priority tests');
    }
    return criticalFailure;
  }

  private applyPlatformFilter(scenarios: BddScenario[], diffFiles: DiffFile[]): BddScenario[] {
    const platform = this.detectPlatformFocus(diffFiles);
    if (!platform) return scenarios;

    this.logger.log(`PR is ${platform}-focused — deprioritizing other platform tests`);

    const deprioritizedPlatform = platform === 'android' ? 'ios' : 'android';

    const primary: BddScenario[] = [];
    const deprioritized: BddScenario[] = [];

    for (const s of scenarios) {
      const text = `${s.feature} ${s.scenario}`.toLowerCase();
      if (text.includes(deprioritizedPlatform)) {
        deprioritized.push(s);
      } else {
        primary.push(s);
      }
    }

    return [...primary, ...deprioritized];
  }

  private detectPlatformFocus(diffFiles: DiffFile[]): 'android' | 'ios' | null {
    let androidScore = 0;
    let iosScore = 0;

    for (const file of diffFiles) {
      const path = file.path.toLowerCase();
      if (ANDROID_EXTENSIONS.some((ext) => path.endsWith(ext)) || ANDROID_PATHS.some((p) => path.includes(p))) {
        androidScore++;
      }
      if (IOS_EXTENSIONS.some((ext) => path.endsWith(ext)) || IOS_PATHS.some((p) => path.includes(p))) {
        iosScore++;
      }
    }

    const total = androidScore + iosScore;
    if (total === 0) return null;
    if (androidScore / total >= 0.8) return 'android';
    if (iosScore / total >= 0.8) return 'ios';
    return null;
  }
}
