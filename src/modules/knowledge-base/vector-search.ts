import axios from 'axios';
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

const EMBEDDING_DIM = 384;

const CREATE_VECTOR_TABLE_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS failure_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario TEXT NOT NULL,
  error TEXT NOT NULL,
  embedding vector(${EMBEDDING_DIM}),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_failure_embeddings_vec ON failure_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
`;

export class VectorSearch {
  private pool: Pool;
  private db: NodePgDatabase;
  private logger = new Logger('VectorSearch');
  private initialized = false;
  private lexicalFallbackWarned = false;

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

    if (!Array.isArray(failure.embedding) || failure.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `indexFailure: embedding must be a ${EMBEDDING_DIM}-dim numeric array (got ${failure.embedding?.length})`,
      );
    }

    await this.db.insert(failureEmbeddingsTable).values({
      scenario: failure.scenario,
      error: failure.error,
      embedding: failure.embedding,
    });

    this.logger.debug(`Indexed failure for "${failure.scenario}"`);
  }

  async findSimilarFailures(query: string, limit: number = 5): Promise<SimilarFailure[]> {
    await this.init();

    const embedding = await this.generateEmbedding(query);
    if (embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `findSimilarFailures: embedding dim mismatch (expected ${EMBEDDING_DIM}, got ${embedding.length})`,
      );
    }
    const embeddingStr = `[${embedding.join(',')}]`;
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    // Drizzle parameterizes `${embeddingStr}` as a PG bind parameter; the `::vector` cast
    // converts the string representation into a vector value for pgvector operators.
    const result = await this.db.execute(sql`
      SELECT scenario, error,
        1 - (embedding <=> ${embeddingStr}::vector) AS similarity
      FROM failure_embeddings
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${safeLimit}
    `);

    return result.rows.map((row: any) => ({
      scenario: row.scenario as string,
      error: row.error as string,
      similarity: parseFloat(row.similarity as string),
    }));
  }

  // Produces a semantic embedding via an external model when an API key is configured,
  // otherwise falls back to a lexical token-hash vector that provides keyword overlap only
  // (NOT semantic similarity). The fallback is clearly logged so callers know search
  // quality is reduced.
  async generateEmbedding(text: string): Promise<number[]> {
    if (process.env.OPENAI_API_KEY) {
      try {
        return await this.generateEmbeddingOpenAI(text);
      } catch (err) {
        this.logger.warn('OpenAI embedding failed, falling back to lexical vector', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (process.env.VOYAGE_API_KEY) {
      try {
        return await this.generateEmbeddingVoyage(text);
      } catch (err) {
        this.logger.warn('Voyage embedding failed, falling back to lexical vector', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!this.lexicalFallbackWarned) {
      this.logger.warn(
        'No OPENAI_API_KEY or VOYAGE_API_KEY — using lexical token-hash fallback. ' +
          'Similarity search will match on keyword overlap only, not semantics.',
      );
      this.lexicalFallbackWarned = true;
    }
    return this.generateLexicalVector(text);
  }

  private async generateEmbeddingOpenAI(text: string): Promise<number[]> {
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        model: 'text-embedding-3-small',
        input: text,
        dimensions: EMBEDDING_DIM,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      },
    );
    const vec = response.data?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      throw new Error(`OpenAI returned unexpected embedding shape: length=${vec?.length}`);
    }
    return vec;
  }

  private async generateEmbeddingVoyage(text: string): Promise<number[]> {
    // voyage-3-lite supports output_dimension so we can match the schema.
    const response = await axios.post(
      'https://api.voyageai.com/v1/embeddings',
      {
        model: 'voyage-3-lite',
        input: text,
        output_dimension: EMBEDDING_DIM,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      },
    );
    const vec = response.data?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      throw new Error(`Voyage returned unexpected embedding shape: length=${vec?.length}`);
    }
    return vec;
  }

  private generateLexicalVector(text: string): number[] {
    const embedding = new Array(EMBEDDING_DIM).fill(0);
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

    if (tokens.length === 0) return embedding;

    for (const token of tokens) {
      const hash = this.hashString(token);
      for (let i = 0; i < 8; i++) {
        const idx = Math.abs((hash * (i + 1)) % EMBEDDING_DIM);
        embedding[idx] += 1.0 / tokens.length;
      }
    }

    const magnitude = Math.sqrt(embedding.reduce((sum: number, v: number) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < EMBEDDING_DIM; i++) {
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
