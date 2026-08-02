import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";

const gzip = promisify(zlib.gzip);

/**
 * Compresse les fichiers de log rotatés (`.log`) en `.gz` et supprime l'original.
 * Ignore le symlink `current.log` et les fichiers déjà compressés.
 *
 * pino-roll@4 ne compresse pas nativement — ce scheduler complète la rotation.
 */

export async function compressRotatedLogFiles(logDir: string): Promise<number> {
  if (!fs.existsSync(logDir)) return 0;

  const entries = await fs.promises.readdir(logDir);
  let compressed = 0;

  for (const name of entries) {
    if (!name.endsWith(".log")) continue;
    if (name === "current.log") continue;

    const full = path.join(logDir, name);
    const gzPath = `${full}.gz`;
    if (fs.existsSync(gzPath)) continue;

    try {
      const stat = await fs.promises.stat(full);
      if (!stat.isFile() || stat.size === 0) continue;

      // Ne pas compresser un fichier encore en cours d'écriture (mtime < 60s).
      if (Date.now() - stat.mtimeMs < 60_000) continue;

      await pipeline(
        fs.createReadStream(full),
        zlib.createGzip({ level: 6 }),
        fs.createWriteStream(gzPath),
      );
      await fs.promises.unlink(full);
      compressed += 1;
    } catch {
      // Best-effort : ne jamais faire échouer le process applicatif.
      try {
        if (fs.existsSync(gzPath)) await fs.promises.unlink(gzPath);
      } catch {
        /* ignore */
      }
    }
  }

  return compressed;
}

let timer: NodeJS.Timeout | null = null;

/** Démarre le scheduler (idempotent). No-op si LOG_TO_FILE/LOG_COMPRESS off. */
export function startLogCompressionScheduler(): void {
  if (timer) return;
  if (process.env.LOG_TO_FILE !== "true" && process.env.LOG_TO_FILE !== "1") {
    return;
  }
  if (process.env.LOG_COMPRESS === "false" || process.env.LOG_COMPRESS === "0") {
    return;
  }

  const logDir = process.env.LOG_DIR?.trim() || "logs";
  const absDir = path.isAbsolute(logDir)
    ? logDir
    : path.join(/* turbopackIgnore: true */ process.cwd(), logDir);

  const tick = () => {
    void compressRotatedLogFiles(absDir);
  };

  tick();
  timer = setInterval(tick, 5 * 60_000);
  timer.unref?.();
}

/** Tests uniquement. */
export function stopLogCompressionScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Exposé pour tests unitaires (gzip buffer). */
export async function gzipBuffer(input: Buffer): Promise<Buffer> {
  return gzip(input);
}
