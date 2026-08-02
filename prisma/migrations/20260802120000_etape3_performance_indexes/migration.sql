-- Étape 3 — index composite demandes CNDP (status + échéance)
CREATE INDEX IF NOT EXISTS "data_subject_requests_status_due_at_idx"
  ON "data_subject_requests" ("status", "due_at");
