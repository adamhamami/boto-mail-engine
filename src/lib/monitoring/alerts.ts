import { getEnv } from "@/lib/config/env";
import type {
  EmailMetrics,
  MonitoringAlert,
  QueueDashboard,
  RedisDashboard,
  SmtpDashboard,
  SystemMetrics,
  WorkerDashboard,
} from "./types";

/**
 * Règles d'alertes automatiques — évaluées à chaque rapport Monitoring.
 * Pas de canal externe (Slack/PagerDuty) en V1 : les alertes sont exposées
 * dans l'UI ops et via /api/ops/metrics. Fail-closed sur seuils dépassés.
 */

export interface AlertEvaluationInput {
  system: SystemMetrics;
  queues: QueueDashboard[];
  redis: RedisDashboard;
  smtp: SmtpDashboard;
  worker: WorkerDashboard;
  email: EmailMetrics;
  databaseOk: boolean;
  redisOk: boolean;
}

function firing(
  id: string,
  severity: MonitoringAlert["severity"],
  title: string,
  message: string,
  metric: string,
  value: number | null,
  threshold: number | null,
): MonitoringAlert {
  return {
    id,
    severity,
    status: "firing",
    title,
    message,
    metric,
    value,
    threshold,
    firedAt: new Date().toISOString(),
  };
}

/** Pure — testable sans réseau. */
export function evaluateMonitoringAlerts(
  input: AlertEvaluationInput,
): MonitoringAlert[] {
  const env = getEnv();
  const alerts: MonitoringAlert[] = [];

  if (!input.databaseOk) {
    alerts.push(
      firing(
        "db_down",
        "critical",
        "Base de données injoignable",
        "La probe readiness PostgreSQL a échoué.",
        "health.database",
        0,
        1,
      ),
    );
  }

  if (!input.redisOk || !input.redis.connected) {
    alerts.push(
      firing(
        "redis_down",
        "critical",
        "Redis injoignable",
        "BullMQ et le cache ops dépendent de Redis.",
        "health.redis",
        0,
        1,
      ),
    );
  }

  if (input.worker.enabled && (input.worker.stale || !input.worker.heartbeatAt)) {
    alerts.push(
      firing(
        "worker_stale",
        "critical",
        "Worker arrêté ou silencieux",
        input.worker.note,
        "worker.heartbeat",
        input.worker.heartbeatAt
          ? Date.now() - new Date(input.worker.heartbeatAt).getTime()
          : null,
        env.ALERT_WORKER_STALE_MS,
      ),
    );
  }

  const dlq = input.queues.find((q) => q.name === "email-dlq");
  const dlqDepth = dlq && dlq.waiting >= 0 ? dlq.waiting + Math.max(0, dlq.failed) : input.email.dlqDepth;
  if (dlqDepth >= 0 && dlqDepth > env.ALERT_DLQ_MAX) {
    alerts.push(
      firing(
        "dlq_depth",
        "critical",
        "Dead Letter Queue non vide",
        `${dlqDepth} job(s) en DLQ (seuil ${env.ALERT_DLQ_MAX}).`,
        "queue.email_dlq",
        dlqDepth,
        env.ALERT_DLQ_MAX,
      ),
    );
  }

  const sendQ = input.queues.find((q) => q.name === "email-send");
  const waiting =
    sendQ && sendQ.waiting >= 0 ? sendQ.waiting : input.email.queueWaiting;
  if (waiting >= 0 && waiting > env.ALERT_QUEUE_WAITING_MAX) {
    alerts.push(
      firing(
        "queue_backlog",
        "warning",
        "File d'envoi saturée",
        `${waiting} job(s) en attente (seuil ${env.ALERT_QUEUE_WAITING_MAX}).`,
        "queue.email_send.waiting",
        waiting,
        env.ALERT_QUEUE_WAITING_MAX,
      ),
    );
  }

  if (
    input.email.counts.sent >= env.AUTO_PAUSE_MIN_EVENTS &&
    input.email.bounceRate > env.ALERT_BOUNCE_RATE_MAX
  ) {
    alerts.push(
      firing(
        "bounce_rate",
        "critical",
        "Taux de bounce élevé",
        `Bounce rate ${(input.email.bounceRate * 100).toFixed(1)}% sur ${input.email.windowMinutes} min (seuil ${(env.ALERT_BOUNCE_RATE_MAX * 100).toFixed(1)}%).`,
        "email.bounce_rate",
        input.email.bounceRate,
        env.ALERT_BOUNCE_RATE_MAX,
      ),
    );
  }

  if (
    input.email.counts.sent >= env.AUTO_PAUSE_MIN_EVENTS &&
    input.email.failureRate > env.ALERT_FAILURE_RATE_MAX
  ) {
    alerts.push(
      firing(
        "failure_rate",
        "warning",
        "Taux d'échec d'envoi élevé",
        `Failure rate ${(input.email.failureRate * 100).toFixed(1)}% (seuil ${(env.ALERT_FAILURE_RATE_MAX * 100).toFixed(1)}%).`,
        "email.failure_rate",
        input.email.failureRate,
        env.ALERT_FAILURE_RATE_MAX,
      ),
    );
  }

  const cpu = input.system.cpu.loadPercent;
  if (cpu !== null && cpu > env.ALERT_CPU_PERCENT_MAX) {
    alerts.push(
      firing(
        "cpu_high",
        "warning",
        "Charge CPU élevée",
        `Load ~${cpu}% (seuil ${env.ALERT_CPU_PERCENT_MAX}%).`,
        "system.cpu.load_percent",
        cpu,
        env.ALERT_CPU_PERCENT_MAX,
      ),
    );
  }

  if (input.system.memory.usedPercent > env.ALERT_RAM_PERCENT_MAX) {
    alerts.push(
      firing(
        "ram_high",
        "warning",
        "Mémoire système élevée",
        `RAM ${input.system.memory.usedPercent}% (seuil ${env.ALERT_RAM_PERCENT_MAX}%).`,
        "system.memory.used_percent",
        input.system.memory.usedPercent,
        env.ALERT_RAM_PERCENT_MAX,
      ),
    );
  }

  if (input.smtp.healthy === false && !input.smtp.dryRun) {
    alerts.push(
      firing(
        "smtp_unhealthy",
        "critical",
        "Connecteur SMTP non sain",
        `Provider ${input.smtp.provider} a échoué le dernier test.`,
        "smtp.healthy",
        0,
        1,
      ),
    );
  }

  if (input.email.retries > env.ALERT_RETRIES_MAX) {
    alerts.push(
      firing(
        "retries_high",
        "warning",
        "Nombre de retries élevé",
        `${input.email.retries} tentatives > 1 sur la fenêtre (seuil ${env.ALERT_RETRIES_MAX}).`,
        "email.retries",
        input.email.retries,
        env.ALERT_RETRIES_MAX,
      ),
    );
  }

  return alerts;
}

export function severityRank(severity: MonitoringAlert["severity"]): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}
