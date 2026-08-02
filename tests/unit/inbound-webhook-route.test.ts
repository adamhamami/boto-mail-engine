import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import { signWebhookPayload } from "@/lib/inbound/signature";

vi.mock("@/lib/inbound/ingest", () => ({
  ingestNormalizedEvent: vi.fn().mockResolvedValue({
    webhookEventId: "wh-1",
    duplicate: false,
    enqueued: true,
  }),
}));

vi.mock("@/lib/api/rate-limit", () => ({
  consumeRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { POST } from "@/app/api/webhooks/mail/route";
import { ingestNormalizedEvent } from "@/lib/inbound/ingest";

const SECRET = "test-only-webhook-secret-do-not-use-in-prod!!";

function signedRequest(body: object, opts?: { sig?: string | null; ts?: number }) {
  const rawBody = JSON.stringify(body);
  const ts = opts?.ts ?? Date.now();
  const headers = new Headers({
    "content-type": "application/json",
    "x-webhook-timestamp": String(ts),
  });
  if (opts?.sig !== null) {
    const sig =
      opts?.sig ?? signWebhookPayload(rawBody, ts, SECRET);
    headers.set("x-webhook-signature", sig);
  }
  return new NextRequest("http://localhost/api/webhooks/mail", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

describe("POST /api/webhooks/mail", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = TEST_ONLY_AUTH_SECRET;
    process.env.WEBHOOK_SECRET = SECRET;
    process.env.WEBHOOK_MAX_AGE_SECONDS = "300";
    process.env.WEBHOOK_MAX_PAYLOAD_BYTES = "65536";
    resetEnvCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetEnvCache();
  });

  it("rejects request without signature", async () => {
    const res = await POST(
      signedRequest(
        {
          eventId: "e1",
          type: "EMAIL_DELIVERED",
          timestamp: new Date().toISOString(),
        },
        { sig: null },
      ),
    );
    expect(res.status).toBe(401);
    expect(ingestNormalizedEvent).not.toHaveBeenCalled();
  });

  it("rejects invalid signature", async () => {
    const res = await POST(
      signedRequest(
        {
          eventId: "e1",
          type: "EMAIL_DELIVERED",
          timestamp: new Date().toISOString(),
        },
        { sig: "00".repeat(32) },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("rejects expired timestamp", async () => {
    const res = await POST(
      signedRequest(
        {
          eventId: "e1",
          type: "EMAIL_DELIVERED",
          timestamp: new Date().toISOString(),
        },
        { ts: Date.now() - 600_000 },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("accepts valid signed event and enqueues", async () => {
    const res = await POST(
      signedRequest({
        eventId: "e1",
        type: "EMAIL_REPLIED",
        timestamp: new Date().toISOString(),
        contactId: "c1",
        campaignId: "camp1",
      }),
    );
    expect(res.status).toBe(202);
    expect(ingestNormalizedEvent).toHaveBeenCalledOnce();
  });
});
