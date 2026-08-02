-- Phase 3 — Pipeline événementiel entrant (additif)

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'EMAIL_DELIVERED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'EMAIL_PROVIDER_ERROR';

ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "provider_event_id" TEXT;

-- Remplir les NULL existants pour permettre l'unicité (événements legacy)
UPDATE "webhook_events"
SET "provider_event_id" = 'legacy-' || "id"
WHERE "provider_event_id" IS NULL;

ALTER TABLE "webhook_events" ALTER COLUMN "provider_event_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_provider_event_id_key"
  ON "webhook_events" ("provider", "provider_event_id");
