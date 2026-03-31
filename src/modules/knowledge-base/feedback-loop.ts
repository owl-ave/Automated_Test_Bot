import { Pool } from 'pg';
import { Logger } from '../../utils/logger';

interface FeedbackStats {
  totalFindings: number;
  dismissed: number;
  fixed: number;
  dismissalRate: number;
}

const CREATE_FEEDBACK_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS finding_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_type TEXT NOT NULL,
  finding TEXT NOT NULL,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  fixed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_finding_feedback_type ON finding_feedback(finding_type);
`;

const SUPPRESSION_THRESHOLD = 0.8;

export class FeedbackLoop {
  private pool: Pool | null;
  private logger = new Logger('FeedbackLoop');
  private initialized = false;

  // In-memory fallback when no DB is available
  private memoryStore: Array<{
    findingType: string;
    finding: string;
    dismissed: boolean;
    fixed: boolean;
  }> = [];

  constructor(databaseUrl?: string) {
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5 }) : null;
  }

  async init(): Promise<void> {
    if (this.initialized || !this.pool) return;
    try {
      await this.pool.query(CREATE_FEEDBACK_TABLE_SQL);
      this.initialized = true;
    } catch (err) {
      this.logger.warn('DB not available, using in-memory feedback store', err);
      this.pool = null;
    }
  }

  async trackDismissal(finding: string, dismissed: boolean): Promise<void> {
    const findingType = this.extractFindingType(finding);

    if (this.pool) {
      await this.init();
      await this.pool.query('INSERT INTO finding_feedback (finding_type, finding, dismissed) VALUES ($1, $2, $3)', [
        findingType,
        finding,
        dismissed,
      ]);
    } else {
      this.memoryStore.push({ findingType, finding, dismissed, fixed: false });
    }

    this.logger.debug(`Tracked dismissal: "${findingType}" dismissed=${dismissed}`);
  }

  async trackFix(finding: string, fixed: boolean): Promise<void> {
    const findingType = this.extractFindingType(finding);

    if (this.pool) {
      await this.init();
      await this.pool.query('INSERT INTO finding_feedback (finding_type, finding, fixed) VALUES ($1, $2, $3)', [
        findingType,
        finding,
        fixed,
      ]);
    } else {
      this.memoryStore.push({ findingType, finding, dismissed: false, fixed });
    }

    this.logger.debug(`Tracked fix: "${findingType}" fixed=${fixed}`);
  }

  async getDismissalRate(findingType: string): Promise<number> {
    if (this.pool) {
      await this.init();
      const result = await this.pool.query(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE dismissed = true) AS dismissed
        FROM finding_feedback
        WHERE finding_type = $1`,
        [findingType],
      );
      const { total, dismissed } = result.rows[0];
      if (Number(total) === 0) return 0;
      return Number(dismissed) / Number(total);
    }

    const relevant = this.memoryStore.filter((f) => f.findingType === findingType);
    if (relevant.length === 0) return 0;
    const dismissed = relevant.filter((f) => f.dismissed).length;
    return dismissed / relevant.length;
  }

  async shouldSuppress(findingType: string): Promise<boolean> {
    const rate = await this.getDismissalRate(findingType);
    const suppress = rate > SUPPRESSION_THRESHOLD;
    if (suppress) {
      this.logger.log(`Suppressing "${findingType}" — dismissal rate ${Math.round(rate * 100)}%`);
    }
    return suppress;
  }

  async getStats(findingType: string): Promise<FeedbackStats> {
    if (this.pool) {
      await this.init();
      const result = await this.pool.query(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE dismissed = true) AS dismissed,
          COUNT(*) FILTER (WHERE fixed = true) AS fixed
        FROM finding_feedback
        WHERE finding_type = $1`,
        [findingType],
      );
      const row = result.rows[0];
      const total = Number(row.total);
      return {
        totalFindings: total,
        dismissed: Number(row.dismissed),
        fixed: Number(row.fixed),
        dismissalRate: total > 0 ? Number(row.dismissed) / total : 0,
      };
    }

    const relevant = this.memoryStore.filter((f) => f.findingType === findingType);
    const dismissed = relevant.filter((f) => f.dismissed).length;
    const fixed = relevant.filter((f) => f.fixed).length;
    return {
      totalFindings: relevant.length,
      dismissed,
      fixed,
      dismissalRate: relevant.length > 0 ? dismissed / relevant.length : 0,
    };
  }

  private extractFindingType(finding: string): string {
    // Extract category from finding string (e.g., "a11y:contrast" from "Accessibility: Low contrast ratio on login button")
    const prefixes = ['accessibility', 'security', 'performance', 'visual', 'api', 'chaos'];
    const lower = finding.toLowerCase();
    for (const prefix of prefixes) {
      if (lower.startsWith(prefix)) return prefix;
    }
    const colonIdx = finding.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      return finding.substring(0, colonIdx).toLowerCase().trim();
    }
    return 'general';
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}
