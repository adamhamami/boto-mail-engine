/**
 * Fail-fast validation des variables d'environnement au démarrage Node.
 * Edge middleware continue d'utiliser process.env pour AUTH_SECRET (Auth.js).
 * Skip pendant `next build` (secrets dummy Docker) et si SKIP_ENV_VALIDATION=1.
 *
 * @see docs/implementation/10-PHASE-1-PROD-SECURITY.md
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  // next build / Docker build-time ARG secrets
  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.SKIP_ENV_VALIDATION === "1"
  ) {
    return;
  }

  const { getEnv } = await import("@/lib/config/env");
  const env = getEnv();

  // Rotation + compression des logs fichiers (si LOG_TO_FILE=true).
  const { startLogCompressionScheduler } = await import(
    "@/lib/logger/compress-rotated"
  );
  startLogCompressionScheduler();

  // Graceful shutdown API (multi-instance) : libère Redis + Prisma.
  const { installGracefulShutdown } = await import(
    "@/lib/ha/graceful-shutdown"
  );
  installGracefulShutdown({
    timeoutMs: env.HA_SHUTDOWN_TIMEOUT_MS,
    exitProcess: false,
    hooks: [
      async () => {
        const { closeQueueInfrastructure } = await import("@/lib/queue");
        await closeQueueInfrastructure();
      },
      async () => {
        const { prisma } = await import("@/lib/db/prisma");
        await prisma.$disconnect();
      },
    ],
  });
}
