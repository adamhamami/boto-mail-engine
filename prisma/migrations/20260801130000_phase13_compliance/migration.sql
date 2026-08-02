-- Phase 13 — Conformité CNDP / Loi 09-08

-- AuditAction extensions
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ANONYMIZE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ERASE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RETENTION';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCESS';

-- Data subject request enums
DO $$ BEGIN
  CREATE TYPE "DataSubjectRequestType" AS ENUM (
    'ACCESS',
    'EXPORT',
    'RECTIFICATION',
    'ERASURE',
    'OBJECTION',
    'RESTRICTION'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "DataSubjectRequestStatus" AS ENUM (
    'RECEIVED',
    'IN_PROGRESS',
    'COMPLETED',
    'REJECTED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Contact compliance fields
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "anonymized_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "contacts_anonymized_at_idx" ON "contacts" ("anonymized_at");
CREATE INDEX IF NOT EXISTS "contacts_legal_hold_idx" ON "contacts" ("legal_hold");

-- Data subject requests
CREATE TABLE IF NOT EXISTS "data_subject_requests" (
  "id" TEXT NOT NULL,
  "type" "DataSubjectRequestType" NOT NULL,
  "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "email" TEXT NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "contact_id" TEXT,
  "requester_name" TEXT,
  "notes" TEXT,
  "legal_basis" TEXT,
  "due_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "result_summary" TEXT,
  "created_by_id" TEXT,
  "assigned_to_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "data_subject_requests_status_idx" ON "data_subject_requests" ("status");
CREATE INDEX IF NOT EXISTS "data_subject_requests_type_idx" ON "data_subject_requests" ("type");
CREATE INDEX IF NOT EXISTS "data_subject_requests_email_normalized_idx" ON "data_subject_requests" ("email_normalized");
CREATE INDEX IF NOT EXISTS "data_subject_requests_contact_id_idx" ON "data_subject_requests" ("contact_id");
CREATE INDEX IF NOT EXISTS "data_subject_requests_due_at_idx" ON "data_subject_requests" ("due_at");
CREATE INDEX IF NOT EXISTS "data_subject_requests_created_at_idx" ON "data_subject_requests" ("created_at");

DO $$ BEGIN
  ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
