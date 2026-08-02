import { getEnv } from "@/lib/config/env";
import { getRedisConnection } from "@/lib/queue";
import { logger } from "@/lib/logger";
import type { MonitoringAlert } from "./types";

const REDIS_KEY = "monitoring:alert-webhook:signature";

/**
 * Notifie un webhook externe quand le set d'alertes change (Étape 5).
 * Fail-open — n'impacte jamais le rapport monitoring.
 */
export async function maybeNotifyAlertWebhook(
  alerts: MonitoringAlert[],
): Promise<void> {
  const url = getEnv().ALERT_WEBHOOK_URL?.trim();
  if (!url) return;

  const signature = alerts
    .map((a) => `${a.id}:${a.severity}`)
    .sort()
    .join("|");

  try {
    const redis = getRedisConnection();
    const prev = await redis.get(REDIS_KEY);
    if (prev === signature) return;
    await redis.set(REDIS_KEY, signature, "EX", 24 * 3600);

    const payload = {
      source: "botoschool-emailing",
      firedAt: new Date().toISOString(),
      count: alerts.length,
      alerts: alerts.map((a) => ({
        id: a.id,
        severity: a.severity,
        title: a.title,
        message: a.message,
        metric: a.metric,
        value: a.value,
        threshold: a.threshold,
      })),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      logger.warn(
        { status: res.status },
        "Alert webhook returned non-OK status",
      );
    }
  } catch (error) {
    logger.warn(
      {
        err:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: "alert webhook failed" },
      },
      "Alert webhook notification failed",
    );
  }
}
