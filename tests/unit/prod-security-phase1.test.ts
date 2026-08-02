import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  isMutatingApiCsrfAllowed,
} from "@/lib/security/security-headers";
import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
} from "@/lib/security/secrets-crypto";
import {
  detectImportMagic,
  validateImportFileMeta,
} from "@/lib/imports/temp-storage";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import { safeFields } from "@/lib/observability/safe-log";
import {
  checkWithTimeout,
  withHealthTimeout,
  HealthCheckTimeoutError,
} from "@/lib/observability/health-timeout";

describe("Phase 1 security headers & CSRF", () => {
  it("builds a CSP without unsafe-eval in production", () => {
    const csp = buildContentSecurityPolicy(true);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows unsafe-eval in development CSP for React Refresh", () => {
    const csp = buildContentSecurityPolicy(false);
    expect(csp).toContain("unsafe-eval");
  });

  it("applies HSTS and CSP on responses", () => {
    const res = applySecurityHeaders(NextResponse.next(), {
      isProduction: true,
      cspEnabled: true,
      cspReportOnly: false,
    });
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("allows matching Origin", () => {
    const headers = new Headers({
      origin: "https://email.botoschool.com",
      host: "email.botoschool.com",
    });
    expect(isMutatingApiCsrfAllowed({ headers }).allowed).toBe(true);
  });

  it("rejects mismatched Origin", () => {
    const headers = new Headers({
      origin: "https://evil.example",
      host: "email.botoschool.com",
    });
    expect(isMutatingApiCsrfAllowed({ headers }).allowed).toBe(false);
  });

  it("allows same-origin Sec-Fetch-Site when Origin absent", () => {
    const headers = new Headers({
      host: "email.botoschool.com",
      "sec-fetch-site": "same-origin",
    });
    expect(isMutatingApiCsrfAllowed({ headers }).allowed).toBe(true);
  });

  it("rejects missing Origin and Sec-Fetch-Site (fail-closed)", () => {
    const headers = new Headers({ host: "email.botoschool.com" });
    expect(isMutatingApiCsrfAllowed({ headers }).allowed).toBe(false);
  });
});

describe("Étape 4 HTML preview sanitize", () => {
  it("strips script tags and event handlers", async () => {
    const { sanitizePreviewHtml } = await import(
      "@/lib/security/html-preview"
    );
    const dirty =
      '<p onclick="alert(1)">Hi</p><script>evil()</script><a href="javascript:alert(1)">x</a>';
    const clean = sanitizePreviewHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("<p");
  });
});

describe("Phase 1 secrets crypto", () => {
  const secret = TEST_ONLY_AUTH_SECRET;
  const previous = `${TEST_ONLY_AUTH_SECRET}-previous-key!!!!`;

  it("encrypts and decrypts round-trip", () => {
    const enc = encryptSecret("smtp-password-value", secret);
    expect(isEncryptedSecret(enc)).toBe(true);
    expect(decryptSecret(enc, secret)).toBe("smtp-password-value");
  });

  it("decrypts with previous secret after rotation", () => {
    const enc = encryptSecret("legacy", previous);
    expect(decryptSecret(enc, secret, previous)).toBe("legacy");
  });
});

describe("Phase 1 import magic bytes", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...snapshot,
      NODE_ENV: "test",
      AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
      IMPORT_MAX_FILE_BYTES: "1048576",
    };
    resetEnvCache();
  });

  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
  });

  it("detects xlsx ZIP signature", () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(detectImportMagic(buf)).toBe(".xlsx");
  });

  it("detects csv text", () => {
    const buf = Buffer.from("email,prenom\na@b.com,Ada\n", "utf8");
    expect(detectImportMagic(buf)).toBe(".csv");
  });

  it("rejects octet-stream without buffer", () => {
    expect(() =>
      validateImportFileMeta({
        filename: "x.csv",
        mimeType: "application/octet-stream",
        sizeBytes: 10,
      }),
    ).toThrow(/octet-stream/i);
  });

  it("rejects extension/magic mismatch", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(() =>
      validateImportFileMeta({
        filename: "fake.csv",
        mimeType: "text/csv",
        sizeBytes: zip.length,
        buffer: zip,
      }),
    ).toThrow(/incohérente/i);
  });
});

describe("Phase 1 health probe timeouts", () => {
  it("returns false when a probe hangs", async () => {
    const start = Date.now();
    const ok = await checkWithTimeout(
      "hanging",
      () => new Promise<boolean>(() => {}),
      100,
    );
    expect(ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("returns the value when the probe resolves in time", async () => {
    expect(await checkWithTimeout("fast", async () => true, 500)).toBe(true);
  });

  it("throws HealthCheckTimeoutError via withHealthTimeout", async () => {
    await expect(
      withHealthTimeout("slow", () => new Promise(() => {}), 50),
    ).rejects.toBeInstanceOf(HealthCheckTimeoutError);
  });
});

describe("Phase 1 safe-log redaction", () => {
  it("redacts nested password fields", () => {
    const out = safeFields({
      user: "admin",
      nested: { password: "secret", ok: 1 },
    });
    expect(out.nested).toEqual({ password: "[Redacted]", ok: 1 });
  });
});
