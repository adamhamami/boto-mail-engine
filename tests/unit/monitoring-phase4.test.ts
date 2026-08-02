import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import { collectSystemMetrics } from "@/lib/monitoring/system-metrics";
import { evaluateMonitoringAlerts } from "@/lib/monitoring/alerts";
import { formatPrometheus } from "@/lib/monitoring/prometheus";
import type {
  EmailMetrics,
  MonitoringReport,
  QueueDashboard,
  RedisDashboard,
  SmtpDashboard,
  SystemMetrics,
  WorkerDashboard,
} from "@/lib/monitoring/types";

const ENV_SNAPSHOT = { ...process.env };

function setEnv(overrides: Record<string, string> = {}): void {
  process.env = {
    ...ENV_SNAPSHOT,
    NODE_ENV: "test",
    AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
    ALERT_DLQ_MAX: "0",
    ALERT_QUEUE_WAITING_MAX: "100",
    ALERT_BOUNCE_RATE_MAX: "0.05",
    ALERT_FAILURE_RATE_MAX: "0.1",
    ALERT_RETRIES_MAX: "50",
    ALERT_WORKER_STALE_MS: "60000",
    ALERT_CPU_PERCENT_MAX: "90",
    ALERT_RAM_PERCENT_MAX: "90",
    AUTO_PAUSE_MIN_EVENTS: "5",
    ...overrides,
  } as NodeJS.ProcessEnv;
  resetEnvCache();
}

afterEach(() => {
  process.env = { ...ENV_SNAPSHOT };
  resetEnvCache();
});

function system(overrides: Partial<SystemMetrics["cpu"]> = {}): SystemMetrics {
  return {
    cpu: {
      loadPercent: 10,
      load1: 0.2,
      load5: 0.2,
      load15: 0.2,
      cores: 4,
      ...overrides,
    },
    memory: {
      totalBytes: 8_000_000_000,
      usedBytes: 2_000_000_000,
      freeBytes: 6_000_000_000,
      usedPercent: 25,
      processRssBytes: 100_000_000,
      processHeapUsedBytes: 50_000_000,
    },
    process: { uptimeSeconds: 100, pid: 1, nodeVersion: "v22" },
  };
}

function queues(dlqWaiting = 0, sendWaiting = 0): QueueDashboard[] {
  return [
    {
      name: "email-send",
      waiting: sendWaiting,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 10,
      paused: false,
    },
    {
      name: "email-dlq",
      waiting: dlqWaiting,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: false,
    },
  ];
}

function redis(connected = true): RedisDashboard {
  return {
    connected,
    version: "7.0",
    uptimeSeconds: 1000,
    usedMemoryBytes: 1_000_000,
    usedMemoryHuman: "1M",
    maxMemoryBytes: 0,
    connectedClients: 2,
    opsPerSecond: 10,
    hitRatePercent: 90,
    role: "master",
  };
}

function smtp(healthy: boolean | null = true): SmtpDashboard {
  return {
    provider: "smtp",
    dryRun: false,
    healthy,
    lastTestAt: new Date().toISOString(),
    status: healthy ? "healthy" : "unhealthy",
    hostMasked: "sm***.example.com",
  };
}

function worker(stale = false): WorkerDashboard {
  return {
    enabled: true,
    heartbeatAt: new Date().toISOString(),
    stale,
    pid: 42,
    hostname: "worker-1",
    workers: ["email-send"],
    instanceCount: stale ? 0 : 1,
    instances: stale
      ? []
      : [
          {
            instanceId: "worker-1:42",
            hostname: "worker-1",
            pid: 42,
            heartbeatAt: new Date().toISOString(),
            workers: ["email-send"],
          },
        ],
    note: stale ? "stale" : "ok",
  };
}

function email(overrides: Partial<EmailMetrics> = {}): EmailMetrics {
  return {
    windowMinutes: 60,
    emailsSent: 100,
    emailsSentTotal: 1000,
    emailsPerMinute: 1.6,
    emailsPerHour: 100,
    avgSendDurationMs: 250,
    bounceRate: 0.01,
    openRate: 0.2,
    replyRate: 0.05,
    failureRate: 0.02,
    retries: 3,
    dlqDepth: 0,
    queueWaiting: 0,
    counts: {
      sent: 100,
      opened: 20,
      replied: 5,
      bounced: 1,
      failed: 2,
      delivered: 90,
    },
    ...overrides,
  };
}

describe("Phase 4 — métriques système", () => {
  it("collecte CPU / RAM / process sans réseau", () => {
    const metrics = collectSystemMetrics();
    expect(metrics.cpu.cores).toBeGreaterThan(0);
    expect(metrics.memory.totalBytes).toBeGreaterThan(0);
    expect(metrics.memory.usedPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.process.pid).toBeGreaterThan(0);
  });
});

describe("Phase 4 — alertes automatiques", () => {
  beforeEach(() => setEnv());

  it("aucune alerte en état nominal", () => {
    const alerts = evaluateMonitoringAlerts({
      system: system(),
      queues: queues(),
      redis: redis(),
      smtp: smtp(true),
      worker: worker(false),
      email: email(),
      databaseOk: true,
      redisOk: true,
    });
    expect(alerts).toHaveLength(0);
  });

  it("alerte critique si DLQ > seuil", () => {
    const alerts = evaluateMonitoringAlerts({
      system: system(),
      queues: queues(3),
      redis: redis(),
      smtp: smtp(true),
      worker: worker(false),
      email: email({ dlqDepth: 3 }),
      databaseOk: true,
      redisOk: true,
    });
    expect(alerts.some((a) => a.id === "dlq_depth")).toBe(true);
    expect(alerts.find((a) => a.id === "dlq_depth")?.severity).toBe("critical");
  });

  it("alerte bounce rate", () => {
    const alerts = evaluateMonitoringAlerts({
      system: system(),
      queues: queues(),
      redis: redis(),
      smtp: smtp(true),
      worker: worker(false),
      email: email({
        bounceRate: 0.2,
        counts: {
          sent: 100,
          opened: 0,
          replied: 0,
          bounced: 20,
          failed: 0,
          delivered: 80,
        },
      }),
      databaseOk: true,
      redisOk: true,
    });
    expect(alerts.some((a) => a.id === "bounce_rate")).toBe(true);
  });

  it("alerte worker stale", () => {
    const alerts = evaluateMonitoringAlerts({
      system: system(),
      queues: queues(),
      redis: redis(),
      smtp: smtp(true),
      worker: worker(true),
      email: email(),
      databaseOk: true,
      redisOk: true,
    });
    expect(alerts.some((a) => a.id === "worker_stale")).toBe(true);
  });

  it("alerte SMTP unhealthy", () => {
    const alerts = evaluateMonitoringAlerts({
      system: system(),
      queues: queues(),
      redis: redis(),
      smtp: smtp(false),
      worker: worker(false),
      email: email(),
      databaseOk: true,
      redisOk: true,
    });
    expect(alerts.some((a) => a.id === "smtp_unhealthy")).toBe(true);
  });

  it("alerte CPU élevé", () => {
    const alerts = evaluateMonitoringAlerts({
      system: system({ loadPercent: 95 }),
      queues: queues(),
      redis: redis(),
      smtp: smtp(true),
      worker: worker(false),
      email: email(),
      databaseOk: true,
      redisOk: true,
    });
    expect(alerts.some((a) => a.id === "cpu_high")).toBe(true);
  });

  it("alerte Redis down", () => {
    const alerts = evaluateMonitoringAlerts({
      system: system(),
      queues: queues(),
      redis: redis(false),
      smtp: smtp(true),
      worker: worker(false),
      email: email(),
      databaseOk: true,
      redisOk: false,
    });
    expect(alerts.some((a) => a.id === "redis_down")).toBe(true);
  });
});

describe("Phase 4 — export Prometheus", () => {
  it("émet les métriques demandées sans secrets", () => {
    const report: MonitoringReport = {
      generatedAt: new Date().toISOString(),
      status: "healthy",
      health: {
        liveness: "up",
        readiness: "ready",
        database: true,
        redis: true,
      },
      system: system(),
      queues: queues(0, 12),
      redis: redis(),
      smtp: smtp(true),
      worker: worker(false),
      email: email(),
      alerts: [],
      secretsExposed: false,
    };

    const text = formatPrometheus(report);
    expect(text).toContain("botoschool_up 1");
    expect(text).toContain("botoschool_cpu_load_percent");
    expect(text).toContain("botoschool_memory_used_percent");
    expect(text).toContain("botoschool_emails_sent");
    expect(text).toContain("botoschool_emails_per_minute");
    expect(text).toContain("botoschool_emails_per_hour");
    expect(text).toContain("botoschool_bounce_rate");
    expect(text).toContain("botoschool_open_rate");
    expect(text).toContain("botoschool_reply_rate");
    expect(text).toContain("botoschool_failure_rate");
    expect(text).toContain("botoschool_retries");
    expect(text).toContain("botoschool_dlq_depth");
    expect(text).toContain('queue="email-send",state="waiting"');
    expect(text).toContain("botoschool_smtp_up");
    expect(text).toContain("botoschool_worker_instances");
    expect(text).toContain("botoschool_email_events");
    expect(text).toContain("botoschool_db_up");
    expect(text).not.toContain("password");
    expect(text).not.toContain("AUTH_SECRET");
  });
});
