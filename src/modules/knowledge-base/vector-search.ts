import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { failureEmbeddingsTable } from '../../db/schema';
import { Logger } from '../../utils/logger';

interface FailureRecord {
  scenario: string;
  error: string;
  embedding: number[];
}

interface SimilarFailure {
  scenario: string;
  error: string;
  similarity: number;
}

const CREATE_VECTOR_TABLE_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS failure_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario TEXT NOT NULL,
  error TEXT NOT NULL,
  embedding vector(384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_failure_embeddings_vec ON failure_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
`;

export class VectorSearch {
  private pool: Pool;
  private db: NodePgDatabase;
  private logger = new Logger('VectorSearch');
  private initialized = false;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
    this.db = drizzle(this.pool);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.pool.query(CREATE_VECTOR_TABLE_SQL);
      this.initialized = true;
      this.logger.log('Vector search tables initialized');
    } catch (err) {
      this.logger.error('Failed to initialize vector tables (pgvector may not be installed)', err);
      throw err;
    }
  }

  async indexFailure(failure: FailureRecord): Promise<void> {
    await this.init();

    await this.db.insert(failureEmbeddingsTable).values({
      scenario: failure.scenario,
      error: failure.error,
      embedding: failure.embedding,
    });

    this.logger.debug(`Indexed failure for "${failure.scenario}"`);
  }

  async findSimilarFailures(query: string, limit: number = 5): Promise<SimilarFailure[]> {
    await this.init();

    const embedding = this.generateEmbedding(query);
    const embeddingStr = `[${embedding.join(',')}]`;

    // Using Drizzle's raw sql builder to calculate the pgvector cosine distance properly
    const result = await this.db.execute(sql`
      SELECT scenario, error,
        1 - (embedding <=> ${embeddingStr}::vector) AS similarity
      FROM failure_embeddings
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);

    return result.rows.map((row: any) => ({
      scenario: row.scenario as string,
      error: row.error as string,
      similarity: parseFloat(row.similarity as string),
    }));
  }

  generateEmbedding(text: string): number[] {
    const dimension = 384;
    const embedding = new Array(dimension).fill(0);
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

    for (const token of tokens) {
      const hash = this.hashString(token);
      for (let i = 0; i < 8; i++) {
        const idx = Math.abs((hash * (i + 1)) % dimension);
        embedding[idx] += 1.0 / tokens.length;
      }
    }

    const magnitude = Math.sqrt(embedding.reduce((sum: number, v: number) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
