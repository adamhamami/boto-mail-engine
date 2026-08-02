/**
 * Rapport Monitoring Phase 4 — dashboards ops + alertes.
 * Aucun secret : hôte SMTP masqué, pas de payloads email.
 */

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "firing" | "resolved";

export interface MonitoringAlert {
  id: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  metric: string;
  value: number | null;
  threshold: number | null;
  firedAt: string;
}

export interface SystemMetrics {
  cpu: {
    /** Charge 1 min normalisée 0–100 (approx. % cœurs). */
    loadPercent: number | null;
    load1: number;
    load5: number;
    load15: number;
    cores: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
    processRssBytes: number;
    processHeapUsedBytes: number;
  };
  process: {
    uptimeSeconds: number;
    pid: number;
    nodeVersion: string;
  };
}

export interface QueueDashboard {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
}

export interface RedisDashboard {
  connected: boolean;
  version: string | null;
  uptimeSeconds: number | null;
  usedMemoryBytes: number | null;
  usedMemoryHuman: string | null;
  maxMemoryBytes: number | null;
  connectedClients: number | null;
  opsPerSecond: number | null;
  hitRatePercent: number | null;
  role: string | null;
}

export interface SmtpDashboard {
  provider: string;
  dryRun: boolean;
  healthy: boolean | null;
  lastTestAt: string | null;
  status: string | null;
  hostMasked: string | null;
}

export interface WorkerInstanceHeartbeat {
  instanceId: string;
  hostname: string;
  pid: number;
  heartbeatAt: string;
  workers: string[];
}

export interface WorkerDashboard {
  enabled: boolean;
  heartbeatAt: string | null;
  stale: boolean;
  pid: number | null;
  hostname: string | null;
  workers: string[];
  /** Nombre d'instances worker avec heartbeat frais (HA). */
  instanceCount: number;
  instances: WorkerInstanceHeartbeat[];
  note: string;
}

export interface EmailMetrics {
  windowMinutes: number;
  emailsSent: number;
  emailsSentTotal: number;
  emailsPerMinute: number;
  emailsPerHour: number;
  /** Latence moyenne sentAt − createdAt (ms) sur la fenêtre. */
  avgSendDurationMs: number | null;
  bounceRate: number;
  openRate: number;
  replyRate: number;
  failureRate: number;
  retries: number;
  dlqDepth: number;
  queueWaiting: number;
  counts: {
    sent: number;
    opened: number;
    replied: number;
    bounced: number;
    failed: number;
    delivered: number;
  };
}

export interface MonitoringReport {
  generatedAt: string;
  correlationId?: string;
  status: "healthy" | "degraded" | "unhealthy";
  health: {
    liveness: "up";
    readiness: "ready" | "not_ready";
    database: boolean;
    redis: boolean;
  };
  system: SystemMetrics;
  queues: QueueDashboard[];
  redis: RedisDashboard;
  smtp: SmtpDashboard;
  worker: WorkerDashboard;
  email: EmailMetrics;
  alerts: MonitoringAlert[];
  secretsExposed: false;
}
