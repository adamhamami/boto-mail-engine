-- Phase 5 — Imports & segmentation

ALTER TABLE "import_batches"
  ADD COLUMN IF NOT EXISTS "rejected_rows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "suppressed_rows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "file_size_bytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "temp_file_path" TEXT,
  ADD COLUMN IF NOT EXISTS "headers" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "mapping_confirmed_at" TIMESTAMP(3);

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "owner_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "contacts"
    ADD CONSTRAINT "contacts_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "contacts_owner_id_idx" ON "contacts"("owner_id");
