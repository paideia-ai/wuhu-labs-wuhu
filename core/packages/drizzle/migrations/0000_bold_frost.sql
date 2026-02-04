CREATE TYPE "public"."sandbox_status" AS ENUM('pending', 'running', 'terminating', 'terminated', 'failed');
--> statement-breakpoint
CREATE TABLE "sandboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"status" "sandbox_status" DEFAULT 'pending' NOT NULL,
	"job_name" text NOT NULL,
	"namespace" text NOT NULL,
	"pod_name" text,
	"pod_ip" text,
	"daemon_port" integer DEFAULT 8787 NOT NULL,
	"preview_port" integer DEFAULT 8066 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"terminated_at" timestamp,
	CONSTRAINT "sandboxes_job_name_unique" UNIQUE("job_name")
);
