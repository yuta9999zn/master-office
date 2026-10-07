ALTER TABLE "tasks" ADD COLUMN "gate_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "gate_approvers" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "gate_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL;