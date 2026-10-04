CREATE TABLE "macro_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"macro_id" text NOT NULL,
	"fn" text NOT NULL,
	"kind" text NOT NULL,
	"schedule" jsonb,
	"created_by" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"last_logs" jsonb,
	"last_ms" integer,
	"failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "macro_triggers" ADD CONSTRAINT "macro_triggers_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_triggers" ADD CONSTRAINT "macro_triggers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "macro_triggers_due_idx" ON "macro_triggers" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "macro_triggers_resource_idx" ON "macro_triggers" USING btree ("resource_id");