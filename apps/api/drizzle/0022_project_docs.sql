CREATE TABLE "task_docs" (
	"task_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_docs_task_id_resource_id_pk" PRIMARY KEY("task_id","resource_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "docs_folder_id" uuid;--> statement-breakpoint
ALTER TABLE "task_docs" ADD CONSTRAINT "task_docs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_docs" ADD CONSTRAINT "task_docs_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_docs" ADD CONSTRAINT "task_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_docs_resource_idx" ON "task_docs" USING btree ("resource_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_docs_folder_id_resources_id_fk" FOREIGN KEY ("docs_folder_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;