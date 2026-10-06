CREATE TABLE "mail_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" uuid,
	"blob_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"folder" text NOT NULL,
	"read_at" timestamp with time zone,
	"starred" boolean DEFAULT false NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"message_id" text NOT NULL,
	"in_reply_to" text,
	"references" text[] DEFAULT '{}'::text[] NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"html" text,
	"author_id" uuid,
	"external" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_messages_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "mail_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assignee_id" uuid
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"space_id" uuid,
	"address" text NOT NULL,
	"name" text NOT NULL,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "mail_domain" text;--> statement-breakpoint
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_message_id_mail_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_blob_id_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_items" ADD CONSTRAINT "mail_items_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_items" ADD CONSTRAINT "mail_items_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_items" ADD CONSTRAINT "mail_items_message_id_mail_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_attachments_message_idx" ON "mail_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_items_unique_idx" ON "mail_items" USING btree ("mailbox_id","message_id","direction");--> statement-breakpoint
CREATE INDEX "mail_items_folder_idx" ON "mail_items" USING btree ("mailbox_id","folder");--> statement-breakpoint
CREATE INDEX "mail_items_thread_idx" ON "mail_items" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "mail_messages_ws_idx" ON "mail_messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mail_threads_mailbox_idx" ON "mail_threads" USING btree ("mailbox_id","last_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_user_idx" ON "mailboxes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_space_idx" ON "mailboxes" USING btree ("space_id");