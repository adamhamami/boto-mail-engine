import type { MonitoringReport } from "./types";

/**
 * Export OpenMetrics / Prometheus text — sans dépendance prom-client.
 * Destiné au scraping (session ops:read OU Bearer METRICS_SCRAPE_TOKEN).
 */

function line(name: string, value: number, labels?: Record<string, string>): string {
  const labelStr = labels
    ? `{${Object.entries(labels)
        .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(",")}}`
    : "";
  return `${name}${labelStr} ${value}`;
}

export function formatPrometheus(report: MonitoringReport): string {
  const lines: string[] = [
    "# HELP botoschool_up Process liveness (always 1 if scrape succeeds)",
    "# TYPE botoschool_up gauge",
    line("botoschool_up", 1),
    "# HELP botoschool_ready Readiness (1=ready)",
    "# TYPE botoschool_ready gauge",
    line("botoschool_ready", report.health.readiness === "ready" ? 1 : 0),
    "# HELP botoschool_db_up PostgreSQL probe",
    "# TYPE botoschool_db_up gauge",
    line("botoschool_db_up", report.health.database ? 1 : 0),
    "# HELP botoschool_status Overall status (0=healthy 1=degraded 2=unhealthy)",
    "# TYPE botoschool_status gauge",
    line(
      "botoschool_status",
      report.status === "healthy" ? 0 : report.status === "degraded" ? 1 : 2,
    ),
    "# HELP botoschool_cpu_load_percent Approximate CPU load percent",
    "# TYPE botoschool_cpu_load_percent gauge",
    line("botoschool_cpu_load_percent", report.system.cpu.loadPercent ?? 0),
    "# HELP botoschool_memory_used_percent System memory used percent",
    "# TYPE botoschool_memory_used_percent gauge",
    line("botoschool_memory_used_percent", report.system.memory.usedPercent),
    "# HELP botoschool_process_rss_bytes Process RSS bytes",
    "# TYPE botoschool_process_rss_bytes gauge",
    line("botoschool_process_rss_bytes", report.system.memory.processRssBytes),
    "# HELP botoschool_emails_sent Emails sent in metrics window",
    "# TYPE botoschool_emails_sent gauge",
    line("botoschool_emails_sent", report.email.emailsSent, {
      window: `${report.email.windowMinutes}m`,
    }),
    "# HELP botoschool_emails_sent_total Emails sent all time",
    "# TYPE botoschool_emails_sent_total counter",
    line("botoschool_emails_sent_total", report.email.emailsSentTotal),
    "# HELP botoschool_emails_per_minute Emails per minute (window average)",
    "# TYPE botoschool_emails_per_minute gauge",
    line("botoschool_emails_per_minute", report.email.emailsPerMinute),
    "# HELP botoschool_emails_per_hour Emails per hour (window average)",
    "# TYPE botoschool_emails_per_hour gauge",
    line("botoschool_emails_per_hour", report.email.emailsPerHour),
    "# HELP botoschool_avg_send_duration_ms Average queue→sent duration",
    "# TYPE botoschool_avg_send_duration_ms gauge",
    line(
      "botoschool_avg_send_duration_ms",
      report.email.avgSendDurationMs ?? 0,
    ),
    "# HELP botoschool_bounce_rate Bounce rate in window",
    "# TYPE botoschool_bounce_rate gauge",
    line("botoschool_bounce_rate", report.email.bounceRate),
    "# HELP botoschool_open_rate Open rate in window",
    "# TYPE botoschool_open_rate gauge",
    line("botoschool_open_rate", report.email.openRate),
    "# HELP botoschool_reply_rate Reply rate in window",
    "# TYPE botoschool_reply_rate gauge",
    line("botoschool_reply_rate", report.email.replyRate),
    "# HELP botoschool_failure_rate Failure rate in window",
    "# TYPE botoschool_failure_rate gauge",
    line("botoschool_failure_rate", report.email.failureRate),
    "# HELP botoschool_retries Retry attempts (>1) in window",
    "# TYPE botoschool_retries gauge",
    line("botoschool_retries", report.email.retries),
    "# HELP botoschool_dlq_depth Email DLQ waiting depth",
    "# TYPE botoschool_dlq_depth gauge",
    line("botoschool_dlq_depth", Math.max(0, report.email.dlqDepth)),
    "# HELP botoschool_email_events Event counts in metrics window",
    "# TYPE botoschool_email_events gauge",
    line("botoschool_email_events", report.email.counts.failed, {
      type: "failed",
    }),
    line("botoschool_email_events", report.email.counts.bounced, {
      type: "bounced",
    }),
    line("botoschool_email_events", report.email.counts.sent, {
      type: "sent",
    }),
    line("botoschool_email_events", report.email.counts.delivered, {
      type: "delivered",
    }),
    "# HELP botoschool_queue_jobs BullMQ job counts",
    "# TYPE botoschool_queue_jobs gauge",
  ];

  for (const q of report.queues) {
    if (q.waiting < 0) continue;
    lines.push(line("botoschool_queue_jobs", q.waiting, { queue: q.name, state: "waiting" }));
    lines.push(line("botoschool_queue_jobs", q.active, { queue: q.name, state: "active" }));
    lines.push(line("botoschool_queue_jobs", q.delayed, { queue: q.name, state: "delayed" }));
    lines.push(line("botoschool_queue_jobs", q.failed, { queue: q.name, state: "failed" }));
  }

  lines.push(
    "# HELP botoschool_alerts_firing Number of firing alerts",
    "# TYPE botoschool_alerts_firing gauge",
    line("botoschool_alerts_firing", report.alerts.length),
    "# HELP botoschool_alert Alert firing by id (1=firing)",
    "# TYPE botoschool_alert gauge",
  );

  for (const a of report.alerts) {
    lines.push(
      line("botoschool_alert", 1, {
        id: a.id,
        severity: a.severity,
      }),
    );
  }

  lines.push(
    "# HELP botoschool_worker_up Worker heartbeat fresh",
    "# TYPE botoschool_worker_up gauge",
    line("botoschool_worker_up", report.worker.stale ? 0 : 1),
    "# HELP botoschool_worker_instances Fresh worker instance count",
    "# TYPE botoschool_worker_instances gauge",
    line("botoschool_worker_instances", report.worker.instanceCount),
    "# HELP botoschool_worker_enabled Worker process intended to run",
    "# TYPE botoschool_worker_enabled gauge",
    line("botoschool_worker_enabled", report.worker.enabled ? 1 : 0),
    "# HELP botoschool_redis_connected Redis connectivity",
    "# TYPE botoschool_redis_connected gauge",
    line("botoschool_redis_connected", report.redis.connected ? 1 : 0),
    "# HELP botoschool_smtp_up SMTP connector healthy (1=ok 0=ko -1=unknown/dry_run)",
    "# TYPE botoschool_smtp_up gauge",
    line(
      "botoschool_smtp_up",
      report.smtp.healthy === true
        ? 1
        : report.smtp.healthy === false
          ? 0
          : -1,
      {
        provider: report.smtp.provider,
        dry_run: report.smtp.dryRun ? "true" : "false",
      },
    ),
    "# HELP botoschool_smtp_dry_run DRY_RUN gate active",
    "# TYPE botoschool_smtp_dry_run gauge",
    line("botoschool_smtp_dry_run", report.smtp.dryRun ? 1 : 0),
  );

  if (report.redis.usedMemoryBytes !== null) {
    lines.push(
      "# HELP botoschool_redis_used_memory_bytes Redis used memory",
      "# TYPE botoschool_redis_used_memory_bytes gauge",
      line("botoschool_redis_used_memory_bytes", report.redis.usedMemoryBytes),
    );
  }

  lines.push("");
  return lines.join("\n");
}
