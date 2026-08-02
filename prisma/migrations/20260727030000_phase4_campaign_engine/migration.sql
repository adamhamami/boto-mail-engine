-- Phase 4 — Moteur campagnes / séquences

DO $$ BEGIN
  CREATE TYPE "RecipientStepStatus" AS ENUM (
    'PENDING',
    'SCHEDULED',
    'QUEUED',
    'SENT',
    'SKIPPED',
    'STOPPED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "campaign_recipients"
  ADD COLUMN IF NOT EXISTS "template_id" TEXT,
  ADD COLUMN IF NOT EXISTS "content_version" INTEGER,
  ADD COLUMN IF NOT EXISTS "scheduled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status" "RecipientStepStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "skip_reason" TEXT;

CREATE INDEX IF NOT EXISTS "campaign_recipients_status_idx"
  ON "campaign_recipients"("status");

CREATE INDEX IF NOT EXISTS "campaign_recipients_scheduled_at_idx"
  ON "campaign_recipients"("scheduled_at");

CREATE INDEX IF NOT EXISTS "campaign_recipients_campaign_id_status_scheduled_at_idx"
  ON "campaign_recipients"("campaign_id", "status", "scheduled_at");
