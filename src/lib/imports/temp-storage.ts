import { createHash } from "node:crypto";
import { mkdir, writeFile, unlink, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";

const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx"]);
const MIME_BY_EXT: Record<string, string[]> = {
  ".csv": ["text/csv", "application/csv", "text/plain"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};

export function getImportTempDir(): string {
  const configured = getEnv().IMPORT_TMP_DIR.trim() || ".tmp/imports";
  return path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

export async function ensureImportTempDir(): Promise<string> {
  const dir = getImportTempDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Signatures magiques — défense hors MIME client. */
export function detectImportMagic(
  buffer: Buffer,
): ".csv" | ".xlsx" | null {
  if (buffer.length >= 4) {
    // ZIP local file header (XLSX = Office Open XML)
    if (
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
      (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
    ) {
      return ".xlsx";
    }
  }

  // CSV : texte sans octets nuls dans l’échantillon
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  if (sample.includes(0)) {
    return null;
  }
  const asText = sample.toString("utf8");
  if (/[\x00-\x08\x0E-\x1F]/.test(asText.replace(/\r|\n|\t/g, ""))) {
    return null;
  }
  return ".csv";
}

export function validateImportFileMeta(params: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  buffer?: Buffer;
}): { extension: ".csv" | ".xlsx"; mimeType: string } {
  const env = getEnv();
  const maxBytes = env.IMPORT_MAX_FILE_BYTES;
  if (params.sizeBytes <= 0) {
    throw new Error("Fichier vide");
  }
  if (params.sizeBytes > maxBytes) {
    throw new Error(
      `Fichier trop grand (max ${Math.floor(maxBytes / (1024 * 1024))} Mo)`,
    );
  }

  const ext = path.extname(params.filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Extension non autorisée (CSV ou XLSX uniquement)");
  }

  const allowedMimes = MIME_BY_EXT[ext] ?? [];
  const mime = params.mimeType.toLowerCase().split(";")[0]!.trim();

  if (mime === "application/octet-stream") {
    // Autorisé uniquement si magic bytes confirment le type
    if (!params.buffer) {
      throw new Error("MIME application/octet-stream refusé sans contrôle contenu");
    }
  } else if (mime && !allowedMimes.includes(mime)) {
    if (ext === ".csv" && mime.startsWith("text/")) {
      // ok
    } else {
      throw new Error(`MIME incohérent avec l'extension ${ext}`);
    }
  }

  if (params.buffer && params.buffer.length > 0) {
    const magic = detectImportMagic(params.buffer);
    if (!magic) {
      throw new Error("Contenu fichier non reconnu (signature invalide)");
    }
    if (magic !== ext) {
      throw new Error(
        `Signature fichier (${magic}) incohérente avec l'extension ${ext}`,
      );
    }
  }

  return {
    extension: ext as ".csv" | ".xlsx",
    mimeType: mime || allowedMimes[0]!,
  };
}

export async function storeImportTempFile(
  buffer: Buffer,
  originalFilename: string,
): Promise<{ absPath: string; relativeKey: string; sha256: string }> {
  const dir = await ensureImportTempDir();
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 24);
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const relativeKey = `${Date.now()}-${hash}-${safeName}`;
  const absPath = path.join(dir, relativeKey);
  await writeFile(absPath, buffer, { mode: 0o600 });
  return {
    absPath,
    relativeKey,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function resolveImportTempPath(relativeKey: string): string {
  const base = getImportTempDir();
  const resolved = path.resolve(base, path.basename(relativeKey));
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error("Chemin temporaire invalide");
  }
  return resolved;
}

export async function purgeImportTempFile(relativeKey: string | null | undefined): Promise<void> {
  if (!relativeKey) return;
  try {
    await unlink(resolveImportTempPath(relativeKey));
  } catch {
    /* already gone */
  }
}

/** Purge fichiers plus vieux que TTL (heures). */
export async function purgeStaleImportTempFiles(
  maxAgeHours = 24,
): Promise<number> {
  const dir = getImportTempDir();
  let purged = 0;
  try {
    const entries = await readdir(dir);
    const cutoff = Date.now() - maxAgeHours * 3600_000;
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const info = await stat(full);
      if (info.mtimeMs < cutoff) {
        await unlink(full);
        purged += 1;
      }
    }
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : "unknown" },
      "Import temp purge skipped",
    );
  }
  return purged;
}
