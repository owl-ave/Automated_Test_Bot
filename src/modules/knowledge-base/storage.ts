import { Pool, PoolConfig } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { testRunsTable } from '../../db/schema';
import { Logger } from '../../utils/logger';

export interface TestRunRecord {
  id?: string;
  prNumber: number;
  scenario: string;
  device: string;
  platform: 'android' | 'ios';
  status: 'pass' | 'fail' | 'warn';
  duration: number;
  failureReason?: string;
  locatorStrategy?: string;
  selfHealed: boolean;
  timestamp: string;
}

interface TestRunFilters {
  scenario?: string;
  device?: string;
  since?: string;
}

const CREATE_TABLE_SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_number INTEGER NOT NULL,
  scenario TEXT NOT NULL,
  device TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'warn')),
  duration INTEGER NOT NULL,
  failure_reason TEXT,
  locator_strategy TEXT,
  self_healed BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_test_runs_scenario ON test_runs(scenario);
CREATE INDEX IF NOT EXISTS idx_test_runs_timestamp ON test_runs(timestamp);
`;

export class TestRunStorage {
  private pool: Pool;
  private db: NodePgDatabase;
  private logger = new Logger('TestRunStorage');
  private initialized = false;

  constructor(databaseUrl: string) {
    const config: PoolConfig = { connectionString: databaseUrl, max: 10 };
    this.pool = new Pool(config);
    this.db = drizzle(this.pool);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      // Drizzle push/migrate is better natively, but we ensure tables exist here gracefully
      await this.pool.query(CREATE_TABLE_SQL);
      this.initialized = true;
      this.logger.log('Database tables initialized');
    } catch (err) {
      this.logger.error('Failed to initialize database', err);
      throw err;
    }
  }

  async saveTestRun(run: TestRunRecord): Promise<string> {
    await this.init();

    const result = await this.db
      .insert(testRunsTable)
      .values({
        prNumber: run.prNumber,
        scenario: run.scenario,
        device: run.device,
        platform: run.platform,
        status: run.status,
        duration: run.duration,
        failureReason: run.failureReason,
        locatorStrategy: run.locatorStrategy,
        selfHealed: run.selfHealed,
        timestamp: run.timestamp,
      })
      .returning({ id: testRunsTable.id });

    const id = result[0].id;
    this.logger.debug(`Saved test run ${id} for "${run.scenario}"`);
    return id;
  }

  async getTestRuns(filters: TestRunFilters): Promise<TestRunRecord[]> {
    await this.init();

    const conditions = [];
    if (filters.scenario) conditions.push(eq(testRunsTable.scenario, filters.scenario));
    if (filters.device) conditions.push(eq(testRunsTable.device, filters.device));
    if (filters.since) conditions.push(gte(testRunsTable.timestamp, filters.since));

    const query = this.db
      .select()
      .from(testRunsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(testRunsTable.timestamp))
      .limit(500);

    const result = await query;

    return result.map((row) => ({
      id: row.id,
      prNumber: row.prNumber,
      scenario: row.scenario,
      device: row.device,
      platform: row.platform as 'android' | 'ios',
      status: row.status as 'pass' | 'fail' | 'warn',
      duration: row.duration,
      failureReason: row.failureReason || undefined,
      locatorStrategy: row.locatorStrategy || undefined,
      selfHealed: row.selfHealed || false,
      timestamp: row.timestamp,
    }));
  }

  async getFailureRate(scenario: string): Promise<number> {
    await this.init();

    const failCountQ = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(testRunsTable)
      .where(and(eq(testRunsTable.scenario, scenario), eq(testRunsTable.status, 'fail')));

    const totalCountQ = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(testRunsTable)
      .where(eq(testRunsTable.scenario, scenario));

    const failures = Number(failCountQ[0]?.count || 0);
    const total = Number(totalCountQ[0]?.count || 0);

    if (total === 0) return 0;
    return failures / total;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
