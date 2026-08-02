import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  WebhookAuthError,
} from "@/lib/inbound/signature";
import { redactEmail } from "@/lib/inbound/types";
import { parseInboundWebhookPayload } from "@/lib/inbound/normalize";

const SECRET = "test-only-webhook-secret-do-not-use-in-prod!!";

describe("webhook signature", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = TEST_ONLY_AUTH_SECRET;
    process.env.WEBHOOK_SECRET = SECRET;
    process.env.WEBHOOK_MAX_AGE_SECONDS = "300";
    resetEnvCache();
  });

  afterEach(() => {
    resetEnvCache();
  });

  it("rejects missing signature", () => {
    expect(() =>
      verifyWebhookSignature({
        rawBody: "{}",
        signatureHeader: null,
        timestampHeader: String(Date.now()),
        secret: SECRET,
      }),
    ).toThrow(WebhookAuthError);

    try {
      verifyWebhookSignature({
        rawBody: "{}",
        signatureHeader: null,
        timestampHeader: String(Date.now()),
        secret: SECRET,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(WebhookAuthError);
      expect((e as WebhookAuthError).code).toBe("MISSING_SIGNATURE");
    }
  });

  it("rejects invalid signature", () => {
    const ts = String(Date.now());
    expect(() =>
      verifyWebhookSignature({
        rawBody: '{"eventId":"1"}',
        signatureHeader: "deadbeef",
        timestampHeader: ts,
        secret: SECRET,
      }),
    ).toThrowError(/Invalid webhook signature/);
  });

  it("rejects expired timestamp", () => {
    const rawBody = '{"eventId":"1"}';
    const ts = Date.now() - 600_000;
    const sig = signWebhookPayload(rawBody, ts, SECRET);

    expect(() =>
      verifyWebhookSignature({
        rawBody,
        signatureHeader: sig,
        timestampHeader: String(ts),
        secret: SECRET,
        maxAgeSeconds: 300,
        nowMs: Date.now(),
      }),
    ).toThrowError(/outside allowed window/);
  });

  it("accepts valid signature within window", () => {
    const rawBody = '{"eventId":"1","type":"EMAIL_DELIVERED"}';
    const ts = Date.now();
    const sig = signWebhookPayload(rawBody, ts, SECRET);

    const result = verifyWebhookSignature({
      rawBody,
      signatureHeader: `sha256=${sig}`,
      timestampHeader: String(ts),
      secret: SECRET,
    });

    expect(result.timestampMs).toBe(ts);
  });
});

describe("inbound payload validation", () => {
  it("rejects unknown event types", () => {
    expect(() =>
      parseInboundWebhookPayload({
        eventId: "e1",
        type: "EMAIL_OPENED",
        timestamp: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("accepts known event types", () => {
    const parsed = parseInboundWebhookPayload({
      eventId: "e1",
      type: "HARD_BOUNCE",
      timestamp: new Date().toISOString(),
      recipient: "a@example.com",
    });
    expect(parsed.type).toBe("HARD_BOUNCE");
  });
});

describe("PII redaction", () => {
  it("redacts emails for logs/storage", () => {
    expect(redactEmail("prospect@botoschool.ma")).toBe("pr***@botoschool.ma");
    expect(redactEmail(null)).toBeNull();
  });
});
