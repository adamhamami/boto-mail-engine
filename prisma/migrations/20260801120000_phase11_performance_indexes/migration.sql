-- Phase 11 — indexes performance (additifs, non cassants)

CREATE INDEX IF NOT EXISTS "send_attempts_status_queued_at_idx"
  ON "send_attempts" ("status", "queued_at");

CREATE INDEX IF NOT EXISTS "send_attempts_provider_message_id_idx"
  ON "send_attempts" ("provider_message_id");

CREATE INDEX IF NOT EXISTS "audit_logs_module_created_at_idx"
  ON "audit_logs" ("module", "created_at");

CREATE INDEX IF NOT EXISTS "audit_logs_action_created_at_idx"
  ON "audit_logs" ("action", "created_at");
