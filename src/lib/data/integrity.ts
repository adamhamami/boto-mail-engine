import { createHash } from "node:crypto";

/**
 * Normalisation canonique des emails (CDC Phase 2).
 * - trim
 * - lowercase
 * - collapse internal whitespace (défense)
 */
export function normalizeEmailAddress(email: string): string {
  return email.trim().replace(/\s+/g, "").toLowerCase();
}

export function buildSendIdempotencyKey(parts: {
  campaignId: string;
  contactId: string;
  sequenceStep: number;
  sequenceVersion: number;
}): string {
  return [
    parts.campaignId,
    parts.contactId,
    String(parts.sequenceStep),
    `v${parts.sequenceVersion}`,
  ].join(":");
}

export function hashContent(parts: Record<string, unknown>): string {
  const payload = JSON.stringify(parts, Object.keys(parts).sort());
  return createHash("sha256").update(payload).digest("hex");
}

export interface ApprovalSnapshot {
  validatedAt: string;
  validatedById: string;
  isTestMode: boolean;
  segment: {
    id: string | null;
    version: number | null;
    filters: unknown;
    contactCount: number | null;
  };
  template: {
    id: string | null;
    version: number | null;
    subject: string | null;
    contentHash: string | null;
  };
  sequence: {
    id: string | null;
    version: number | null;
    stepCount: number | null;
  };
  sender: {
    fromEmail: string;
    fromName: string;
  };
  quotas: {
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
  };
  scheduleWindows: unknown;
  settings: unknown;
  contentHash: string;
}

export function buildApprovalContentHash(input: {
  templateId: string | null;
  templateVersion: number | null;
  templateSubject: string | null;
  templateBodyHtml: string | null;
  sequenceId: string | null;
  sequenceVersion: number | null;
  segmentId: string | null;
  segmentVersion: number | null;
  segmentFilters: unknown;
  settings: unknown;
  fromEmail: string;
}): string {
  return hashContent({
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    templateSubject: input.templateSubject,
    templateBodyHtml: input.templateBodyHtml,
    sequenceId: input.sequenceId,
    sequenceVersion: input.sequenceVersion,
    segmentId: input.segmentId,
    segmentVersion: input.segmentVersion,
    segmentFilters: input.segmentFilters,
    settings: input.settings,
    fromEmail: input.fromEmail,
  });
}
