ALTER TABLE "projects" ADD COLUMN "workflow" text DEFAULT 'scrum' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "strict_workflow" boolean DEFAULT false NOT NULL;