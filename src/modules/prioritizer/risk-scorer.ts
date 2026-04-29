import { MaestroFlow, DiffFile } from '../../types';
import { Logger } from '../../utils/logger';

export interface HistoricalTestRun {
  scenario: string;
  passed: boolean;
  device: string;
  timestamp: string;
}

interface RiskFactors {
  changeSize: number;
  historicalFailureRate: number;
  flowCriticality: number;
  platformRisk: number;
  recency: number;
}

const WEIGHT_CHANGE_SIZE = 0.25;
const WEIGHT_HISTORICAL_FAILURE = 0.3;
const WEIGHT_FLOW_CRITICALITY = 0.25;
const WEIGHT_PLATFORM_RISK = 0.1;
const WEIGHT_RECENCY = 0.1;

const CRITICAL_KEYWORDS = ['login', 'auth', 'payment', 'checkout', 'signup', 'register', 'password', 'onboarding'];
const HIGH_RISK_EXTENSIONS = ['.kt', '.swift', '.java', '.m', '.mm', '.dart'];

export class RiskScorer {
  private logger = new Logger('RiskScorer');

  scoreTest(flow: MaestroFlow, diffFiles: DiffFile[], historicalData?: HistoricalTestRun[]): number {
    const factors = this.computeFactors(flow, diffFiles, historicalData);
    const raw =
      factors.changeSize * WEIGHT_CHANGE_SIZE +
      factors.historicalFailureRate * WEIGHT_HISTORICAL_FAILURE +
      factors.flowCriticality * WEIGHT_FLOW_CRITICALITY +
      factors.platformRisk * WEIGHT_PLATFORM_RISK +
      factors.recency * WEIGHT_RECENCY;

    const score = Math.round(Math.min(100, Math.max(0, raw)));
    this.logger.debug(`Score for "${flow.scenario}": ${score}`, factors);
    return score;
  }

  private computeFactors(
    flow: MaestroFlow,
    diffFiles: DiffFile[],
    historicalData?: HistoricalTestRun[],
  ): RiskFactors {
    return {
      changeSize: this.computeChangeSizeRisk(diffFiles),
      historicalFailureRate: this.computeHistoricalRisk(flow.scenario, historicalData),
      flowCriticality: this.computeFlowCriticality(flow),
      platformRisk: this.computePlatformRisk(diffFiles),
      recency: this.computeRecencyRisk(diffFiles),
    };
  }

  private computeChangeSizeRisk(diffFiles: DiffFile[]): number {
    const totalChanges = diffFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);
    if (totalChanges > 500) return 100;
    if (totalChanges > 200) return 80;
    if (totalChanges > 100) return 60;
    if (totalChanges > 50) return 40;
    return 20;
  }

  private computeHistoricalRisk(scenario: string, history?: HistoricalTestRun[]): number {
    if (!history || history.length === 0) return 50; // unknown = medium risk
    const relevant = history.filter((h) => h.scenario === scenario);
    if (relevant.length === 0) return 50;
    const failures = relevant.filter((h) => !h.passed).length;
    return Math.round((failures / relevant.length) * 100);
  }

  private computeFlowCriticality(flow: MaestroFlow): number {
    const text = `${flow.feature} ${flow.scenario}`.toLowerCase();
    const matchCount = CRITICAL_KEYWORDS.filter((kw) => text.includes(kw)).length;
    if (matchCount >= 3) return 100;
    if (matchCount >= 2) return 80;
    if (matchCount >= 1) return 60;

    // Fall back to scanning the YAML body — visible labels in the flow
    // (e.g. "Sign in", "Pay", "Checkout") still carry the criticality signal.
    const yamlMatches = CRITICAL_KEYWORDS.filter((kw) => flow.yaml.toLowerCase().includes(kw)).length;
    if (yamlMatches >= 1) return 50;

    return 20;
  }

  private computePlatformRisk(diffFiles: DiffFile[]): number {
    const nativeChanges = diffFiles.filter((f) => HIGH_RISK_EXTENSIONS.some((ext) => f.path.endsWith(ext))).length;
    const ratio = diffFiles.length > 0 ? nativeChanges / diffFiles.length : 0;
    return Math.round(ratio * 100);
  }

  private computeRecencyRisk(diffFiles: DiffFile[]): number {
    const deletedOrModified = diffFiles.filter((f) => f.status === 'modified' || f.status === 'deleted');
    const ratio = diffFiles.length > 0 ? deletedOrModified.length / diffFiles.length : 0;
    return Math.round(ratio * 80 + 20);
  }
}
