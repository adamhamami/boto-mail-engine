import fs from "node:fs";

/**
 * Docker Secrets / *_FILE convention (Phase 7).
 * Si `FOO_FILE` pointe vers un fichier, sa valeur écrase `FOO`.
 * Compatible Swarm/Compose `/run/secrets/*`.
 */
const SECRET_FILE_KEYS = [
  "AUTH_SECRET",
  "AUTH_SECRET_PREVIOUS",
  "WEBHOOK_SECRET",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "SMTP_PASSWORD",
  "SMTP_USER",
  "REDIS_URL",
] as const;

export function applyDockerSecretFiles(
  env: Record<string, string | undefined> = process.env,
): void {
  for (const key of SECRET_FILE_KEYS) {
    const fileKey = `${key}_FILE`;
    const filePath = env[fileKey]?.trim();
    if (!filePath) continue;
    try {
      const value = fs.readFileSync(filePath, "utf8").trim();
      if (value.length > 0) {
        env[key] = value;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unreadable secret file";
      throw new Error(`${fileKey}=${filePath} could not be read: ${message}`);
    }
  }

  // Construit DATABASE_URL si mot de passe secret + composants présents.
  if (
    (!env.DATABASE_URL || env.DATABASE_URL.includes("CHANGE_ME")) &&
    env.POSTGRES_PASSWORD &&
    env.POSTGRES_USER &&
    env.POSTGRES_DB
  ) {
    const host = env.POSTGRES_HOST?.trim() || "postgres";
    const port = env.POSTGRES_PORT?.trim() || "5432";
    const user = encodeURIComponent(env.POSTGRES_USER);
    const pass = encodeURIComponent(env.POSTGRES_PASSWORD);
    const db = env.POSTGRES_DB;
    env.DATABASE_URL = `postgresql://${user}:${pass}@${host}:${port}/${db}?schema=public`;
  }
}
