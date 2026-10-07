CREATE TABLE "base_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" text NOT NULL,
	"auto_number" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"primary_field_id" uuid,
	"auto_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "base_comments" ADD CONSTRAINT "base_comments_record_id_base_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."base_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_comments" ADD CONSTRAINT "base_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_fields" ADD CONSTRAINT "base_fields_table_id_base_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."base_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_records" ADD CONSTRAINT "base_records_table_id_base_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."base_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_records" ADD CONSTRAINT "base_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_records" ADD CONSTRAINT "base_records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_tables" ADD CONSTRAINT "base_tables_base_id_resources_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_views" ADD CONSTRAINT "base_views_table_id_base_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."base_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_views" ADD CONSTRAINT "base_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "base_comments_record_idx" ON "base_comments" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "base_fields_table_idx" ON "base_fields" USING btree ("table_id","position");--> statement-breakpoint
CREATE INDEX "base_records_table_idx" ON "base_records" USING btree ("table_id","position");--> statement-breakpoint
CREATE INDEX "base_tables_base_idx" ON "base_tables" USING btree ("base_id","position");--> statement-breakpoint
CREATE INDEX "base_views_table_idx" ON "base_views" USING btree ("table_id","position");