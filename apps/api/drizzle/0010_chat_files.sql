CREATE TABLE "message_refs" (
	"message_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'attachment' NOT NULL,
	CONSTRAINT "message_refs_message_id_resource_id_pk" PRIMARY KEY("message_id","resource_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "pinned_by" uuid;--> statement-breakpoint
ALTER TABLE "message_refs" ADD CONSTRAINT "message_refs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_refs" ADD CONSTRAINT "message_refs_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_refs_resource_idx" ON "message_refs" USING btree ("resource_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;