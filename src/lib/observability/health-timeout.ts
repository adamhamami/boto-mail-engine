/**
 * Garde-fou de latence pour les probes de santé.
 *
 * Contexte : la connexion Redis BullMQ utilise `maxRetriesPerRequest: null`
 * (requis par BullMQ pour les workers) — un `ping()` peut donc attendre
 * indéfiniment si Redis est injoignable. Un endpoint /api/health doit
 * répondre vite pour un load balancer.
 */
export class HealthCheckTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`Health check "${label}" timed out after ${timeoutMs}ms`);
    this.name = "HealthCheckTimeoutError";
  }
}

export const DEFAULT_HEALTH_TIMEOUT_MS = 2000;

export async function withHealthTimeout<T>(
  label: string,
  operation: () => Promise<T>,
  timeoutMs: number = DEFAULT_HEALTH_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new HealthCheckTimeoutError(label, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Variante booléenne : jamais de throw, false si échec ou timeout. */
export async function checkWithTimeout(
  label: string,
  operation: () => Promise<boolean>,
  timeoutMs: number = DEFAULT_HEALTH_TIMEOUT_MS,
): Promise<boolean> {
  try {
    return await withHealthTimeout(label, operation, timeoutMs);
  } catch {
    return false;
  }
}
