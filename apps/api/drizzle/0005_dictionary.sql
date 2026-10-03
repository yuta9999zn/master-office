CREATE TABLE "user_dictionary" (
	"user_id" uuid NOT NULL,
	"word" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_dictionary_user_id_word_pk" PRIMARY KEY("user_id","word")
);
--> statement-breakpoint
ALTER TABLE "user_dictionary" ADD CONSTRAINT "user_dictionary_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;