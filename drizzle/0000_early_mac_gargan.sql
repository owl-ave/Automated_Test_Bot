CREATE TABLE "failure_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario" text NOT NULL,
	"error" text NOT NULL,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pr_number" integer NOT NULL,
	"scenario" text NOT NULL,
	"device" text NOT NULL,
	"platform" text NOT NULL,
	"status" text NOT NULL,
	"duration" integer NOT NULL,
	"failure_reason" text,
	"locator_strategy" text,
	"self_healed" boolean DEFAULT false,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_test_runs_scenario" ON "test_runs" USING btree ("scenario");--> statement-breakpoint
CREATE INDEX "idx_test_runs_timestamp" ON "test_runs" USING btree ("timestamp");