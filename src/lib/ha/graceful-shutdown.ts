import { logger } from "@/lib/logger";

export type ShutdownHook = () => Promise<void> | void;

export interface GracefulShutdownOptions {
  /** Timeout forcé avant exit(1). */
  timeoutMs: number;
  hooks: ShutdownHook[];
  /** process.exit après hooks (défaut true pour workers). */
  exitProcess?: boolean;
}

let shuttingDown = false;

/**
 * Enregistre SIGTERM/SIGINT avec drain ordonné + timeout.
 * Idempotent : un second signal est ignoré pendant le drain.
 */
export function installGracefulShutdown(
  options: GracefulShutdownOptions,
): () => Promise<void> {
  const exitProcess = options.exitProcess ?? true;

  const run = async (signal: string) => {
    if (shuttingDown) {
      logger.warn({ signal }, "Shutdown already in progress");
      return;
    }
    shuttingDown = true;
    logger.info(
      { signal, timeoutMs: options.timeoutMs, hooks: options.hooks.length },
      "Graceful shutdown started",
    );

    const forceTimer = setTimeout(() => {
      logger.error(
        { timeoutMs: options.timeoutMs },
        "Graceful shutdown timed out — forcing exit",
      );
      if (exitProcess) process.exit(1);
    }, options.timeoutMs);
    forceTimer.unref?.();

    try {
      for (const hook of options.hooks) {
        await hook();
      }
      logger.info("Graceful shutdown completed");
      if (exitProcess) process.exit(0);
    } catch (error) {
      logger.error(
        {
          err:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: "shutdown hook failed" },
        },
        "Graceful shutdown failed",
      );
      if (exitProcess) process.exit(1);
    } finally {
      clearTimeout(forceTimer);
    }
  };

  process.on("SIGTERM", () => {
    void run("SIGTERM");
  });
  process.on("SIGINT", () => {
    void run("SIGINT");
  });

  return () => run("manual");
}

/** Tests uniquement. */
export function resetShutdownStateForTests(): void {
  shuttingDown = false;
}
