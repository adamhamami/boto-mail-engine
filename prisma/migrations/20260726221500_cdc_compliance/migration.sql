-- CDC compliance: statuses, eligibility, test mode, unsubscribe

-- ─── ContactStatus (recreate) ────────────────────────────────────────────────
CREATE TYPE "ContactStatus_new" AS ENUM (
  'IMPORTED',
  'TO_REVIEW',
  'ELIGIBLE',
  'DISQUALIFIED',
  'IN_SEQUENCE',
  'RESPONDED',
  'UNSUBSCRIBED',
  'HARD_BOUNCED',
  'BLOCKED'
);

ALTER TABLE "contacts" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "contacts"
  ALTER COLUMN "status" TYPE "ContactStatus_new"
  USING (
    CASE status::text
      WHEN 'NEW' THEN 'TO_REVIEW'::"ContactStatus_new"
      WHEN 'QUALIFIED' THEN 'ELIGIBLE'::"ContactStatus_new"
      WHEN 'CONTACTED' THEN 'IN_SEQUENCE'::"ContactStatus_new"
      WHEN 'BOUNCED' THEN 'HARD_BOUNCED'::"ContactStatus_new"
      WHEN 'DISQUALIFIED' THEN 'DISQUALIFIED'::"ContactStatus_new"
      WHEN 'RESPONDED' THEN 'RESPONDED'::"ContactStatus_new"
      WHEN 'UNSUBSCRIBED' THEN 'UNSUBSCRIBED'::"ContactStatus_new"
      ELSE 'TO_REVIEW'::"ContactStatus_new"
    END
  );

DROP TYPE "ContactStatus";
ALTER TYPE "ContactStatus_new" RENAME TO "ContactStatus";
ALTER TABLE "contacts" ALTER COLUMN "status" SET DEFAULT 'IMPORTED'::"ContactStatus";

-- ─── CampaignStatus + TESTED ─────────────────────────────────────────────────
ALTER TYPE "CampaignStatus" ADD VALUE 'TESTED';

-- ─── Contact fields ──────────────────────────────────────────────────────────
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_base" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "eligibility_notes" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "is_test_recipient" BOOLEAN NOT NULL DEFAULT false;

-- ─── Campaign fields ─────────────────────────────────────────────────────────
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "is_test_mode" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "tested_at" TIMESTAMP(3);

-- ─── Recipients ──────────────────────────────────────────────────────────────
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "is_stopped" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "stop_reason" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "unsubscribe_token" TEXT;

UPDATE "campaign_recipients"
SET "unsubscribe_token" = md5(random()::text || id || clock_timestamp()::text)
WHERE "unsubscribe_token" IS NULL;

ALTER TABLE "campaign_recipients" ALTER COLUMN "unsubscribe_token" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_unsubscribe_token_key"
  ON "campaign_recipients"("unsubscribe_token");

CREATE INDEX IF NOT EXISTS "campaign_recipients_is_stopped_idx"
  ON "campaign_recipients"("is_stopped");
