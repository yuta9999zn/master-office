ALTER TYPE "public"."resource_type" ADD VALUE 'note';--> statement-breakpoint
CREATE TABLE "resource_links" (
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "resource_links_source_id_target_id_pk" PRIMARY KEY("source_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "resource_links" ADD CONSTRAINT "resource_links_source_id_resources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_links" ADD CONSTRAINT "resource_links_target_id_resources_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_links_target_idx" ON "resource_links" USING btree ("target_id");