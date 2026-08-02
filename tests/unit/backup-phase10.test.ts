import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

describe("Phase 10 — backup helpers", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bs-backup-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists backup dirs that contain manifest.json", async () => {
    const { listBackupDirs } = await import("../../scripts/backup/lib.mjs");
    fs.mkdirSync(path.join(dir, "2026-01-01T00-00-00-000Z"));
    fs.writeFileSync(
      path.join(dir, "2026-01-01T00-00-00-000Z", "manifest.json"),
      JSON.stringify({ id: "a" }),
    );
    fs.mkdirSync(path.join(dir, "orphan"));
    const listed = listBackupDirs(dir);
    expect(listed).toEqual(["2026-01-01T00-00-00-000Z"]);
  });

  it("rotates by count", async () => {
    const { runRotate } = await import("../../scripts/backup/rotate.mjs");
    for (let i = 0; i < 5; i++) {
      const name = `2026-01-0${i + 1}T00-00-00-000Z`;
      const full = path.join(dir, name);
      fs.mkdirSync(full);
      fs.writeFileSync(
        path.join(full, "manifest.json"),
        JSON.stringify({
          id: name,
          finishedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
        }),
      );
    }

    const result = await runRotate({
      backupDir: dir,
      retentionCount: 2,
      retentionDays: 3650,
    });

    expect(result.kept).toHaveLength(2);
    expect(result.deleted.length).toBeGreaterThanOrEqual(3);
  });

  it("verifies sha256 of postgres artifact", async () => {
    const { verifyBackupDir } = await import("../../scripts/backup/verify.mjs");
    const snap = path.join(dir, "snap");
    fs.mkdirSync(path.join(snap, "uploads"), { recursive: true });
    fs.mkdirSync(path.join(snap, "redis"), { recursive: true });

    // Minimal fake custom dump header for size check path; TOC verify may soft-fail without docker
    const dump = Buffer.concat([
      Buffer.from("PGDMP"),
      Buffer.alloc(64, 1),
    ]);
    const dumpPath = path.join(snap, "postgres.dump");
    fs.writeFileSync(dumpPath, dump);
    const sha = createHash("sha256").update(dump).digest("hex");

    const rdb = Buffer.from("REDIS");
    const rdbPath = path.join(snap, "redis", "dump.rdb");
    fs.writeFileSync(rdbPath, rdb);
    const rdbSha = createHash("sha256").update(rdb).digest("hex");

    fs.writeFileSync(
      path.join(snap, "manifest.json"),
      JSON.stringify({
        id: "snap",
        postgres: { file: "postgres.dump", sha256: sha, bytes: dump.length },
        redis: [{ file: "redis/dump.rdb", sha256: rdbSha, bytes: rdb.length }],
        uploads: [{ empty: true }],
      }),
    );

    const result = await verifyBackupDir(snap, { strict: false });
    expect(result.checks.postgresChecksum?.ok).toBe(true);
    expect(result.checks.redis?.[0]?.ok).toBe(true);
    // TOC may fail without pg_restore/docker — checksum path must still work
    expect(result.checks.manifest?.ok).toBe(true);
  });
});
