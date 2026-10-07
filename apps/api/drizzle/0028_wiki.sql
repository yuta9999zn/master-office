CREATE TABLE "wiki_pages" (
	"resource_id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"position" text NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"template" text,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"folder_id" uuid NOT NULL,
	"home_page_id" uuid,
	"project_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_space_id_wiki_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."wiki_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_spaces" ADD CONSTRAINT "wiki_spaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_spaces" ADD CONSTRAINT "wiki_spaces_folder_id_resources_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_spaces" ADD CONSTRAINT "wiki_spaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_spaces" ADD CONSTRAINT "wiki_spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wiki_pages_space_idx" ON "wiki_pages" USING btree ("space_id","parent_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_spaces_key_idx" ON "wiki_spaces" USING btree ("workspace_id","key");