/**
 * Backup rotation — keep last N and/or delete older than retention days
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  listBackupDirs,
  log,
  readManifest,
  resolveConfig,
  ROOT,
} from "./lib.mjs";

export async function runRotate(cliOpts = {}) {
  const cfg = resolveConfig(cliOpts);
  const retentionDays =
    cliOpts.retentionDays != null
      ? Number(cliOpts.retentionDays)
      : cfg.retentionDays;
  const retentionCount =
    cliOpts.retentionCount != null
      ? Number(cliOpts.retentionCount)
      : cfg.retentionCount;

  const dirs = listBackupDirs(cfg.backupDir);
  if (dirs.length === 0) {
    log("No backups to rotate");
    return { deleted: [], kept: [] };
  }

  const now = Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  const deleted = [];
  const kept = [];

  // Sort newest first (listBackupDirs already reverse-sorted by name/ISO stamp)
  for (let i = 0; i < dirs.length; i++) {
    const name = dirs[i];
    const full = path.join(cfg.backupDir, name);
    let finishedAt = null;
    try {
      const manifest = await readManifest(full);
      finishedAt = manifest.finishedAt || manifest.startedAt;
    } catch {
      /* treat as deletable if unreadable and beyond count */
    }

    const ageMs = finishedAt
      ? now - new Date(finishedAt).getTime()
      : Number.POSITIVE_INFINITY;
    const beyondCount = i >= retentionCount;
    const beyondAge = Number.isFinite(ageMs) && ageMs > maxAgeMs;

    if (beyondCount || beyondAge) {
      log(
        `Rotate delete ${name} (count=${beyondCount} age=${beyondAge} days=${retentionDays} keep=${retentionCount})`,
      );
      await rm(full, { recursive: true, force: true });
      deleted.push(name);
    } else {
      kept.push(name);
    }
  }

  log(
    `Rotation done — kept=${kept.length} deleted=${deleted.length} dir=${path.relative(ROOT, cfg.backupDir)}`,
  );
  return { deleted, kept, retentionDays, retentionCount };
}
