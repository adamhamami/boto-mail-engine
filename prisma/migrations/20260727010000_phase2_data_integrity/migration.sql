-- Phase 2 — Intégrité données (non destructive)
-- Aucune DROP TABLE / TRUNCATE. Pas de suppression de contacts.
-- Unicité email via index partiel (actifs non-doublons uniquement).

-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "SalesTaskType" AS ENUM ('REPLY_FOLLOW_UP', 'DEMO_REQUEST', 'QUALIFICATION', 'OTHER');
CREATE TYPE "SalesTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE "SalesTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "EmailDuplicateResolutionStatus" AS ENUM ('DETECTED', 'MARKED_DUPLICATE', 'MERGED', 'DISMISSED');

-- ─── Contacts : email_normalized ─────────────────────────────────────────────
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "email_normalized" TEXT;

UPDATE "contacts"
SET "email_normalized" = lower(trim(both FROM "email"))
WHERE "email_normalized" IS NULL;

-- Marquer les doublons (conserver le plus ancien comme canonique) — pas de delete
WITH ranked AS (
  SELECT
    id,
    email_normalized,
    ROW_NUMBER() OVER (
      PARTITION BY email_normalized
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY email_normalized
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM "contacts"
  WHERE deleted_at IS NULL
    AND email_normalized IS NOT NULL
)
UPDATE "contacts" c
SET
  is_duplicate = TRUE,
  duplicate_of_id = ranked.canonical_id,
  status = CASE
    WHEN c.status = 'ELIGIBLE' THEN 'TO_REVIEW'::"ContactStatus"
    ELSE c.status
  END,
  updated_at = NOW()
FROM ranked
WHERE c.id = ranked.id
  AND ranked.rn > 1;

ALTER TABLE "contacts" ALTER COLUMN "email_normalized" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "contacts_email_normalized_idx" ON "contacts"("email_normalized");
CREATE INDEX IF NOT EXISTS "contacts_status_deleted_at_idx" ON "contacts"("status", "deleted_at");
CREATE INDEX IF NOT EXISTS "contacts_city_idx" ON "contacts"("city");

-- Unicité partielle : un seul contact actif non-doublon par email normalisé
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_email_normalized_active_unique"
  ON "contacts" ("email_normalized")
  WHERE "deleted_at" IS NULL AND "is_duplicate" = FALSE;

-- ─── Segments / Templates / Sequences : versioning ───────────────────────────
ALTER TABLE "segments" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS "segments_version_idx" ON "segments"("version");

ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "content_hash" TEXT;
CREATE INDEX IF NOT EXISTS "templates_version_idx" ON "templates"("version");

ALTER TABLE "sequences" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS "sequences_version_idx" ON "sequences"("version");

-- ─── Campaigns : snapshot d’approbation ──────────────────────────────────────
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "approval_snapshot" JSONB;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "approved_content_hash" TEXT;
CREATE INDEX IF NOT EXISTS "campaigns_validated_at_idx" ON "campaigns"("validated_at");

-- ─── Campaign recipients : version séquence + nouvelle unicité ───────────────
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "sequence_step_id" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "sequence_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "campaign_recipients" DROP CONSTRAINT IF EXISTS "campaign_recipients_campaign_id_contact_id_sequence_step_key";

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_campaign_id_contact_id_sequence_step_sequence_version_key"
  ON "campaign_recipients" ("campaign_id", "contact_id", "sequence_step", "sequence_version");

CREATE INDEX IF NOT EXISTS "campaign_recipients_campaign_id_is_stopped_is_sent_idx"
  ON "campaign_recipients" ("campaign_id", "is_stopped", "is_sent");

-- ─── Suppression list : email_normalized ─────────────────────────────────────
ALTER TABLE "suppression_list" ADD COLUMN IF NOT EXISTS "email_normalized" TEXT;

UPDATE "suppression_list"
SET "email_normalized" = lower(trim(both FROM "email"))
WHERE "email_normalized" IS NULL;

-- Dédupliquer suppressions avant unique (garder la plus ancienne)
DELETE FROM "suppression_list" a
USING "suppression_list" b
WHERE a.email_normalized = b.email_normalized
  AND a.created_at > b.created_at;

ALTER TABLE "suppression_list" ALTER COLUMN "email_normalized" SET NOT NULL;

ALTER TABLE "suppression_list" DROP CONSTRAINT IF EXISTS "suppression_list_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "suppression_list_email_normalized_key"
  ON "suppression_list" ("email_normalized");
CREATE INDEX IF NOT EXISTS "suppression_list_email_idx" ON "suppression_list"("email");

-- ─── Events index ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "events_type_occurred_at_idx" ON "events"("type", "occurred_at");

-- ─── Sales tasks ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_tasks" (
  "id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "campaign_id" TEXT,
  "event_id" TEXT,
  "type" "SalesTaskType" NOT NULL DEFAULT 'REPLY_FOLLOW_UP',
  "status" "SalesTaskStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "SalesTaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "owner_id" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "due_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_by_id" TEXT,
  CONSTRAINT "sales_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sales_tasks_status_idx" ON "sales_tasks"("status");
CREATE INDEX IF NOT EXISTS "sales_tasks_contact_id_idx" ON "sales_tasks"("contact_id");
CREATE INDEX IF NOT EXISTS "sales_tasks_campaign_id_idx" ON "sales_tasks"("campaign_id");
CREATE INDEX IF NOT EXISTS "sales_tasks_owner_id_idx" ON "sales_tasks"("owner_id");
CREATE INDEX IF NOT EXISTS "sales_tasks_due_at_idx" ON "sales_tasks"("due_at");

ALTER TABLE "sales_tasks"
  DROP CONSTRAINT IF EXISTS "sales_tasks_contact_id_fkey",
  ADD CONSTRAINT "sales_tasks_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_tasks"
  DROP CONSTRAINT IF EXISTS "sales_tasks_campaign_id_fkey",
  ADD CONSTRAINT "sales_tasks_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_tasks"
  DROP CONSTRAINT IF EXISTS "sales_tasks_event_id_fkey",
  ADD CONSTRAINT "sales_tasks_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_tasks"
  DROP CONSTRAINT IF EXISTS "sales_tasks_owner_id_fkey",
  ADD CONSTRAINT "sales_tasks_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_tasks"
  DROP CONSTRAINT IF EXISTS "sales_tasks_created_by_id_fkey",
  ADD CONSTRAINT "sales_tasks_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Email duplicate resolutions (traçabilité) ───────────────────────────────
CREATE TABLE IF NOT EXISTS "email_duplicate_resolutions" (
  "id" TEXT NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "contact_ids" TEXT[],
  "canonical_contact_id" TEXT,
  "status" "EmailDuplicateResolutionStatus" NOT NULL DEFAULT 'DETECTED',
  "notes" TEXT,
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "resolved_by_id" TEXT,
  CONSTRAINT "email_duplicate_resolutions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_duplicate_resolutions_email_normalized_idx"
  ON "email_duplicate_resolutions"("email_normalized");
CREATE INDEX IF NOT EXISTS "email_duplicate_resolutions_status_idx"
  ON "email_duplicate_resolutions"("status");
CREATE INDEX IF NOT EXISTS "email_duplicate_resolutions_detected_at_idx"
  ON "email_duplicate_resolutions"("detected_at");

ALTER TABLE "email_duplicate_resolutions"
  DROP CONSTRAINT IF EXISTS "email_duplicate_resolutions_canonical_contact_id_fkey",
  ADD CONSTRAINT "email_duplicate_resolutions_canonical_contact_id_fkey"
    FOREIGN KEY ("canonical_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "email_duplicate_resolutions"
  DROP CONSTRAINT IF EXISTS "email_duplicate_resolutions_resolved_by_id_fkey",
  ADD CONSTRAINT "email_duplicate_resolutions_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
