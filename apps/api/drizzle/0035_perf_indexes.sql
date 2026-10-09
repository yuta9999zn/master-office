CREATE INDEX "audit_ws_time_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "resource_access_recent_idx" ON "resource_access" USING btree ("user_id","accessed_at");--> statement-breakpoint
CREATE INDEX "resources_ws_type_updated_idx" ON "resources" USING btree ("workspace_id","type","updated_at");--> statement-breakpoint
CREATE INDEX "tasks_sprint_idx" ON "tasks" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "tasks_creator_idx" ON "tasks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resources_publish_token_idx" ON "resources" ((metadata->'publish'->>'token')) WHERE metadata->'publish'->>'token' IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "resources_name_trgm_idx" ON "resources" USING gin ("name" gin_trgm_ops);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pg_trgm not available (no privilege): name search stays a sequential scan';
END $$;
