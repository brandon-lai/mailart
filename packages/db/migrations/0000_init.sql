CREATE TABLE "blocked_recipients" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_slug" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"address_line" text,
	"sender_city" text NOT NULL,
	"body" text NOT NULL,
	"seed" text,
	"recipe" text,
	"envelope_spec" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"gif_url" text,
	"png_url" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text,
	CONSTRAINT "letters_public_slug_unique" UNIQUE("public_slug")
);
--> statement-breakpoint
CREATE TABLE "render_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"sender_id" uuid NOT NULL,
	"letter_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letters_sender_created" ON "letters" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "letters_recipient_created" ON "letters" USING btree (lower("recipient_email"),"created_at");--> statement-breakpoint
CREATE INDEX "letters_ip_created" ON "letters" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "render_jobs_claim" ON "render_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "senders_email_key" ON "senders" USING btree (lower("email"));