ALTER TABLE "space_members" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "kind" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_visibility" text DEFAULT 'leads' NOT NULL;