CREATE TABLE "task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_watchers" (
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "task_watchers_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "methodology" text DEFAULT 'kanban' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "intake_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "type" text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reporter_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "story_points" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "triage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_from_id_tasks_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_to_id_tasks_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_links_pair_idx" ON "task_links" USING btree ("from_id","to_id","kind");--> statement-breakpoint
CREATE INDEX "task_links_to_idx" ON "task_links" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "task_watchers_user_idx" ON "task_watchers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_users_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Existing data: subtasks were the only children; the creator reported the task; the creator leads the project.
UPDATE "tasks" SET "type" = 'subtask' WHERE "parent_id" IS NOT NULL;--> statement-breakpoint
UPDATE "tasks" SET "reporter_id" = "created_by" WHERE "reporter_id" IS NULL;--> statement-breakpoint
UPDATE "projects" SET "lead_id" = "created_by" WHERE "lead_id" IS NULL;
