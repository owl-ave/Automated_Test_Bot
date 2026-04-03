import { pgTable, text, timestamp, integer, boolean, uuid, index, customType } from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(384)';
  },
  toDriver(value: number[]) {
    return `[${value.join(',')}]`;
  },
});

export const testRunsTable = pgTable(
  'test_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prNumber: integer('pr_number').notNull(),
    scenario: text('scenario').notNull(),
    device: text('device').notNull(),
    platform: text('platform').notNull(),
    status: text('status').notNull(),
    duration: integer('duration').notNull(),
    failureReason: text('failure_reason'),
    locatorStrategy: text('locator_strategy'),
    selfHealed: boolean('self_healed').default(false),
    timestamp: timestamp('timestamp', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    branch: text('branch').notNull().default('main'),
    repoFullName: text('repo_full_name').notNull().default(''),
    commitSha: text('commit_sha'),
  },
  (table) => {
    return [
      index('idx_test_runs_scenario').on(table.scenario),
      index('idx_test_runs_timestamp').on(table.timestamp),
      index('idx_test_runs_branch').on(table.repoFullName, table.branch),
    ];
  },
);

export const failureEmbeddingsTable = pgTable('failure_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenario: text('scenario').notNull(),
  error: text('error').notNull(),
  embedding: vector('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});
