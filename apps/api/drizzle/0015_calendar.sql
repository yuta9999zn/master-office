CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"kind" text DEFAULT 'event' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"recurrence" jsonb,
	"exdates" text[] DEFAULT '{}'::text[] NOT NULL,
	"meeting_url" text,
	"meeting_provider" text,
	"color" text,
	"visibility" text DEFAULT 'default' NOT NULL,
	"organizer_id" uuid,
	"attachments" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"space_id" uuid,
	"name" text NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"timezone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"name" text,
	"response" text DEFAULT 'pending' NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_range_idx" ON "calendar_events" USING btree ("calendar_id","start_at","end_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_user_idx" ON "calendars" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_space_idx" ON "calendars" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_attendees_unique_idx" ON "event_attendees" USING btree ("event_id","email");--> statement-breakpoint
CREATE INDEX "event_attendees_user_idx" ON "event_attendees" USING btree ("user_id");