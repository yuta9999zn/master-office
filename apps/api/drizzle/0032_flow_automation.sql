CREATE TABLE "flow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" text NOT NULL,
	"trigger_node_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pending" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resume_at" timestamp with time zone,
	"error" text,
	"run_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "flow_triggers" (
	"flow_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"next_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_triggers_flow_id_node_id_pk" PRIMARY KEY("flow_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_flow_id_resources_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_triggers" ADD CONSTRAINT "flow_triggers_flow_id_resources_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_triggers" ADD CONSTRAINT "flow_triggers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_runs_flow_idx" ON "flow_runs" USING btree ("flow_id","started_at");--> statement-breakpoint
CREATE INDEX "flow_runs_due_idx" ON "flow_runs" USING btree ("status","resume_at");--> statement-breakpoint
CREATE INDEX "flow_triggers_type_idx" ON "flow_triggers" USING btree ("workspace_id","type","enabled");--> statement-breakpoint
CREATE INDEX "flow_triggers_due_idx" ON "flow_triggers" USING btree ("enabled","next_run_at");