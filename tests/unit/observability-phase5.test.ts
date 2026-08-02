import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  getCorrelationId,
  getRequestId,
  getTraceId,
  observabilityJobFields,
  observabilityLogFields,
  runWithContext,
} from "@/lib/observability/context";
import {
  childSpan,
  formatTraceparent,
  resolveTraceContext,
} from "@/lib/observability/tracing";
import { enrichAuditMetadata } from "@/modules/audit/services/audit.service";
import {
  compressRotatedLogFiles,
  stopLogCompressionScheduler,
} from "@/lib/logger/compress-rotated";

afterEach(() => {
  stopLogCompressionScheduler();
});

describe("Phase 5 — Correlation / Request / Trace IDs", () => {
  it("propage correlationId et requestId distincts", () => {
    runWithContext(
      { correlationId: "corr-1", requestId: "req-1" },
      () => {
        expect(getCorrelationId()).toBe("corr-1");
        expect(getRequestId()).toBe("req-1");
        const fields = observabilityLogFields();
        expect(fields.correlationId).toBe("corr-1");
        expect(fields.requestId).toBe("req-1");
      },
    );
  });

  it("génère un requestId si absent", () => {
    runWithContext({ correlationId: "corr-only" }, () => {
      expect(getRequestId()).not.toBe("no-request");
      expect(getRequestId().length).toBeGreaterThan(10);
    });
  });

  it("embarque les IDs dans un snapshot job BullMQ", () => {
    runWithContext(
      {
        correlationId: "corr-job",
        requestId: "req-job",
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
      },
      () => {
        const job = observabilityJobFields();
        expect(job.correlationId).toBe("corr-job");
        expect(job.requestId).toBe("req-job");
        expect(job.traceId).toBe("a".repeat(32));
        expect(job.spanId).toBe("b".repeat(16));
      },
    );
  });
});

describe("Phase 5 — Tracing W3C", () => {
  it("parse un traceparent valide et crée un span enfant", () => {
    const parent = formatTraceparent("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7");
    const ctx = resolveTraceContext(parent);

    expect(ctx.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(ctx.parentSpanId).toBe("00f067aa0ba902b7");
    expect(ctx.spanId).not.toBe("00f067aa0ba902b7");
    expect(ctx.traceparent).toContain(ctx.traceId);
    expect(ctx.traceparent).toContain(ctx.spanId);
  });

  it("génère un contexte si header absent", () => {
    const ctx = resolveTraceContext(null);
    expect(ctx.traceId).toHaveLength(32);
    expect(ctx.spanId).toHaveLength(16);
    expect(ctx.sampled).toBe(true);
  });

  it("refuse un traceparent invalide", () => {
    const ctx = resolveTraceContext("not-a-trace");
    expect(ctx.traceId).toHaveLength(32);
  });

  it("childSpan conserve le traceId", () => {
    const parent = resolveTraceContext(null);
    const child = childSpan(parent);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.spanId).not.toBe(parent.spanId);
  });

  it("expose traceId dans le contexte ALS", () => {
    const trace = resolveTraceContext(null);
    runWithContext(
      {
        correlationId: "c",
        requestId: "r",
        traceId: trace.traceId,
        spanId: trace.spanId,
      },
      () => {
        expect(getTraceId()).toBe(trace.traceId);
        expect(observabilityLogFields().traceId).toBe(trace.traceId);
        expect(observabilityLogFields().spanId).toBe(trace.spanId);
      },
    );
  });
});

describe("Phase 5 — Audit enrichi", () => {
  it("injecte correlationId / requestId / traceId dans metadata", () => {
    runWithContext(
      {
        correlationId: "audit-corr",
        requestId: "audit-req",
        traceId: "c".repeat(32),
        spanId: "d".repeat(16),
        campaignId: "camp-9",
      },
      () => {
        const meta = enrichAuditMetadata({ actionDetail: "test" });
        expect(meta.correlationId).toBe("audit-corr");
        expect(meta.requestId).toBe("audit-req");
        expect(meta.traceId).toBe("c".repeat(32));
        expect(meta.spanId).toBe("d".repeat(16));
        expect(meta.campaignId).toBe("camp-9");
        expect(meta.actionDetail).toBe("test");
      },
    );
  });

  it("ne surcharge pas les champs déjà fournis", () => {
    runWithContext(
      { correlationId: "from-ctx", requestId: "req" },
      () => {
        const meta = enrichAuditMetadata({ correlationId: "explicit" });
        expect(meta.correlationId).toBe("explicit");
        expect(meta.requestId).toBe("req");
      },
    );
  });
});

describe("Phase 5 — Compression des logs rotatés", () => {
  it("compresse un .log inactif en .gz et supprime l'original", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boto-logs-"));
    const file = path.join(dir, "app.2026-08-01.1.log");
    fs.writeFileSync(file, '{"msg":"hello"}\n'.repeat(20));
    // mtime dans le passé pour passer le garde-fou 60s
    const past = new Date(Date.now() - 120_000);
    fs.utimesSync(file, past, past);

    const count = await compressRotatedLogFiles(dir);
    expect(count).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(`${file}.gz`)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ignore current.log et les fichiers récents", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boto-logs-"));
    fs.writeFileSync(path.join(dir, "current.log"), "active\n");
    fs.writeFileSync(path.join(dir, "fresh.log"), "fresh\n");

    const count = await compressRotatedLogFiles(dir);
    expect(count).toBe(0);
    expect(fs.existsSync(path.join(dir, "current.log"))).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
