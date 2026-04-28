import { Pool, PoolConfig } from 'pg';
import { Logger } from '../../utils/logger';

export interface LocatorCacheKey {
  appVersion: string;
  screenFingerprint: string;
  hint: string;
}

export interface LocatorCacheEntry extends LocatorCacheKey {
  strategy: string;
  value: string;
  x: number | null;
  y: number | null;
  confidence: number;
}

const CREATE_TABLE_SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS locator_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_version TEXT NOT NULL,
  screen_fingerprint TEXT NOT NULL,
  hint TEXT NOT NULL,
  strategy TEXT NOT NULL,
  value TEXT NOT NULL,
  x INTEGER,
  y INTEGER,
  confidence INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_used TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_version, screen_fingerprint, hint)
);
CREATE INDEX IF NOT EXISTS idx_locator_cache_lookup
  ON locator_cache(app_version, screen_fingerprint, hint);
`;

export class LocatorCache {
  private pool: Pool;
  private logger = new Logger('LocatorCache');
  private initialized = false;

  constructor(databaseUrl: string) {
    const config: PoolConfig = { connectionString: databaseUrl, max: 5 };
    this.pool = new Pool(config);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.pool.query(CREATE_TABLE_SQL);
      this.initialized = true;
      this.logger.debug('locator_cache table ready');
    } catch (err) {
      this.logger.error('Failed to initialize locator_cache', err);
      throw err;
    }
  }

  async lookup(key: LocatorCacheKey): Promise<LocatorCacheEntry | null> {
    await this.init();
    const normalizedHint = normalizeHint(key.hint);
    const res = await this.pool.query(
      `SELECT app_version, screen_fingerprint, hint, strategy, value, x, y, confidence
       FROM locator_cache
       WHERE app_version = $1 AND screen_fingerprint = $2 AND hint = $3
       LIMIT 1`,
      [key.appVersion, key.screenFingerprint, normalizedHint],
    );
    if (res.rows.length === 0) return null;

    // Touch hit_count + last_used so least-recently-used entries can be evicted later.
    await this.pool
      .query(
        `UPDATE locator_cache SET hit_count = hit_count + 1, last_used = NOW()
         WHERE app_version = $1 AND screen_fingerprint = $2 AND hint = $3`,
        [key.appVersion, key.screenFingerprint, normalizedHint],
      )
      .catch(() => {});

    const row = res.rows[0];
    return {
      appVersion: row.app_version,
      screenFingerprint: row.screen_fingerprint,
      hint: row.hint,
      strategy: row.strategy,
      value: row.value,
      x: row.x,
      y: row.y,
      confidence: row.confidence,
    };
  }

  async store(entry: LocatorCacheEntry): Promise<void> {
    await this.init();
    const normalizedHint = normalizeHint(entry.hint);
    await this.pool.query(
      `INSERT INTO locator_cache
         (app_version, screen_fingerprint, hint, strategy, value, x, y, confidence, hit_count, last_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, NOW())
       ON CONFLICT (app_version, screen_fingerprint, hint)
       DO UPDATE SET strategy = EXCLUDED.strategy, value = EXCLUDED.value,
                     x = EXCLUDED.x, y = EXCLUDED.y, confidence = EXCLUDED.confidence,
                     last_used = NOW()`,
      [
        entry.appVersion,
        entry.screenFingerprint,
        normalizedHint,
        entry.strategy,
        entry.value,
        entry.x,
        entry.y,
        entry.confidence,
      ],
    );
  }

  // Evict every cached entry for an app version — used when a new build hash arrives.
  async invalidateAppVersion(appVersion: string): Promise<number> {
    await this.init();
    const res = await this.pool.query(
      `DELETE FROM locator_cache WHERE app_version = $1`,
      [appVersion],
    );
    const deleted = res.rowCount ?? 0;
    this.logger.log(`Invalidated ${deleted} cached locators for app_version=${appVersion}`);
    return deleted;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function normalizeHint(hint: string): string {
  return hint.trim().toLowerCase();
}
