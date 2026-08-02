import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import { parseCsvBuffer, parseXlsxBuffer } from "@/lib/imports/parse-file";
import {
  applyMapping,
  mapRawToImportRow,
  suggestMapping,
} from "@/lib/imports/mapping";
import {
  neutralizeCsvFormula,
  toCsvDocument,
} from "@/lib/export/csv-safe";
import { buildContactFilterWhere } from "@/modules/segments/repositories/segment.repository";
import { buildApprovalContentHash } from "@/lib/data/integrity";

const fixtures = path.join(process.cwd(), "tests", "fixtures");

describe("Phase 5 import parsers", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = TEST_ONLY_AUTH_SECRET;
    process.env.IMPORT_MAX_ROWS = "10000";
    process.env.IMPORT_MAX_FILE_BYTES = String(5 * 1024 * 1024);
    resetEnvCache();
  });

  afterEach(() => resetEnvCache());

  it("parses real CSV fixture with headers", async () => {
    const buf = readFileSync(path.join(fixtures, "import-sample.csv"));
    const sheet = await parseCsvBuffer(buf);
    expect(sheet.headers[0]?.toLowerCase()).toContain("email");
    expect(sheet.rows.length).toBeGreaterThanOrEqual(4);
  });

  it("parses real XLSX fixture", async () => {
    const buf = readFileSync(path.join(fixtures, "import-sample.xlsx"));
    const sheet = await parseXlsxBuffer(buf);
    expect(sheet.headers[0]?.toLowerCase()).toBe("email");
    expect(sheet.rows.length).toBe(2);
    expect(sheet.rows[0]![0]).toBe("xlsx1@exemple.com");
  });

  it("rejects malformed CSV", async () => {
    // Unclosed quote — csv-parse throws
    await expect(
      parseCsvBuffer(Buffer.from('"email,broken\n')),
    ).rejects.toThrow(/malformé|CSV/i);
  });

  it("maps columns and validates emails / duplicates pattern", () => {
    const headers = ["email", "prenom", "nom"];
    const mapping = suggestMapping(headers);
    expect(mapping.email).toBe("email");
    expect(mapping.prenom).toBe("firstName");

    const raw = applyMapping(headers, ["a@b.com", "Jean", "D"], mapping);
    const ok = mapRawToImportRow(raw);
    expect(ok.ok).toBe(true);

    const bad = mapRawToImportRow(
      applyMapping(headers, ["not-an-email", "X", "Y"], mapping),
    );
    expect(bad.ok).toBe(false);
  });

  it("detects formula-looking cells without executing them", async () => {
    const buf = readFileSync(path.join(fixtures, "import-sample.csv"));
    const sheet = await parseCsvBuffer(buf);
    const formulaRow = sheet.rows.find((r) => r[0]?.startsWith("="));
    expect(formulaRow?.[0]).toMatch(/^=/);
  });
});

describe("Phase 5 CSV export safety", () => {
  it("neutralizes formula injection", () => {
    expect(neutralizeCsvFormula("=CMD()")).toBe("'=CMD()");
    expect(neutralizeCsvFormula("+1+1")).toBe("'+1+1");
    expect(neutralizeCsvFormula("-2+3")).toBe("'-2+3");
    expect(neutralizeCsvFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeCsvFormula("safe")).toBe("safe");
  });

  it("builds CSV with neutralization", () => {
    const csv = toCsvDocument(["email", "note"], [["a@b.com", "=1+1"]]);
    expect(csv).toContain("'=1+1");
  });
});

describe("Phase 5 segment filters CDC", () => {
  it("builds where with city, type, size, eligibility", () => {
    const where = buildContactFilterWhere({
      city: "Casablanca",
      establishmentType: "prive",
      organizationSize: "M",
      eligibleOnly: true,
      tags: ["edu"],
    });
    expect(where.deletedAt).toBeNull();
    expect(where.status).toBe("ELIGIBLE");
    expect(where.tags).toEqual({ hasEvery: ["edu"] });
    expect(where.organization).toBeTruthy();
  });

  it("approval snapshot hash includes segment version/filters", () => {
    const a = buildApprovalContentHash({
      templateId: "t1",
      templateVersion: 1,
      templateSubject: "s",
      templateBodyHtml: "<p>x</p>",
      sequenceId: "s1",
      sequenceVersion: 1,
      segmentId: "seg1",
      segmentVersion: 2,
      segmentFilters: { city: "Rabat", eligibleOnly: true },
      settings: {},
      fromEmail: "noreply@botoschool.com",
    });
    const b = buildApprovalContentHash({
      templateId: "t1",
      templateVersion: 1,
      templateSubject: "s",
      templateBodyHtml: "<p>x</p>",
      sequenceId: "s1",
      sequenceVersion: 1,
      segmentId: "seg1",
      segmentVersion: 3,
      segmentFilters: { city: "Rabat", eligibleOnly: true },
      settings: {},
      fromEmail: "noreply@botoschool.com",
    });
    expect(a).not.toBe(b);
  });
});

describe("Phase 5 file size guard", () => {
  it("rejects oversized via validateImportFileMeta", async () => {
    process.env.IMPORT_MAX_FILE_BYTES = "10";
    resetEnvCache();
    const { validateImportFileMeta } = await import("@/lib/imports/temp-storage");
    expect(() =>
      validateImportFileMeta({
        filename: "big.csv",
        mimeType: "text/csv",
        sizeBytes: 100,
      }),
    ).toThrow(/trop grand/i);
  });
});
