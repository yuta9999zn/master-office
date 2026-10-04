CREATE TABLE "qa_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"text" text NOT NULL,
	"author_name" text,
	"author_id" uuid,
	"voter" text NOT NULL,
	"votes" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"token" text NOT NULL,
	"started_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"presenting" uuid,
	CONSTRAINT "qa_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "qa_votes" (
	"question_id" uuid NOT NULL,
	"voter" text NOT NULL,
	CONSTRAINT "qa_votes_question_id_voter_pk" PRIMARY KEY("question_id","voter")
);
--> statement-breakpoint
ALTER TABLE "qa_questions" ADD CONSTRAINT "qa_questions_session_id_qa_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."qa_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_questions" ADD CONSTRAINT "qa_questions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_sessions" ADD CONSTRAINT "qa_sessions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_sessions" ADD CONSTRAINT "qa_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_votes" ADD CONSTRAINT "qa_votes_question_id_qa_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."qa_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qa_questions_session_idx" ON "qa_questions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "qa_sessions_resource_idx" ON "qa_sessions" USING btree ("resource_id");