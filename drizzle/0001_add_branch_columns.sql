ALTER TABLE "test_runs" ADD COLUMN "branch" text NOT NULL DEFAULT 'main';
ALTER TABLE "test_runs" ADD COLUMN "repo_full_name" text NOT NULL DEFAULT '';
ALTER TABLE "test_runs" ADD COLUMN "commit_sha" text;
CREATE INDEX "idx_test_runs_branch" ON "test_runs" ("repo_full_name", "branch");
