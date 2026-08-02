"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchApi } from "@/lib/api/client";

interface MonitoringReport {
  generatedAt: string;
  status: "healthy" | "degraded" | "unhealthy";
  health: {
    liveness: "up";
    readiness: "ready" | "not_ready";
    database: boolean;
    redis: boolean;
  };
  system: {
    cpu: { loadPercent: number | null; load1: number; cores: number };
    memory: {
      usedPercent: number;
      usedBytes: number;
      totalBytes: number;
      processRssBytes: number;
    };
    process: { uptimeSeconds: number; pid: number; nodeVersion: string };
  };
  queues: Array<{
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
    paused: boolean;
  }>;
  redis: {
    connected: boolean;
    version: string | null;
    uptimeSeconds: number | null;
    usedMemoryHuman: string | null;
    connectedClients: number | null;
    opsPerSecond: number | null;
    hitRatePercent: number | null;
    role: string | null;
  };
  smtp: {
    provider: string;
    dryRun: boolean;
    healthy: boolean | null;
    lastTestAt: string | null;
    status: string | null;
    hostMasked: string | null;
  };
  worker: {
    enabled: boolean;
    heartbeatAt: string | null;
    stale: boolean;
    pid: number | null;
    hostname: string | null;
    workers: string[];
    instanceCount?: number;
    note: string;
  };
  email: {
    windowMinutes: number;
    emailsSent: number;
    emailsSentTotal: number;
    emailsPerMinute: number;
    emailsPerHour: number;
    avgSendDurationMs: number | null;
    bounceRate: number;
    openRate: number;
    replyRate: number;
    failureRate: number;
    retries: number;
    dlqDepth: number;
    queueWaiting: number;
    counts?: {
      sent: number;
      opened: number;
      replied: number;
      bounced: number;
      failed: number;
      delivered: number;
    };
  };
  alerts: Array<{
    id: string;
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
    metric: string;
    value: number | null;
    threshold: number | null;
    firedAt: string;
  }>;
  secretsExposed: false;
  grafanaUrl?: string | null;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Africa/Casablanca",
  }).format(new Date(iso));
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function severityVariant(
  severity: string,
): "default" | "secondary" | "destructive" {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "secondary";
  return "default";
}

export function MonitoringClient() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["ops-monitoring"],
    queryFn: () => fetchApi<MonitoringReport>("/api/ops/monitoring"),
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Chargement du monitoring…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <p role="alert" className="text-destructive">
            {error instanceof Error
              ? error.message
              : "Impossible de charger /api/ops/monitoring"}
          </p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  const report = data.data;
  const errorCount =
    (report.email.counts?.failed ?? 0) + (report.email.counts?.bounced ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant={
            report.status === "healthy"
              ? "default"
              : report.status === "unhealthy"
                ? "destructive"
                : "secondary"
          }
        >
          {report.status}
        </Badge>
        <Badge variant="outline">liveness: {report.health.liveness}</Badge>
        <Badge
          variant={
            report.health.readiness === "ready" ? "outline" : "destructive"
          }
        >
          readiness: {report.health.readiness}
        </Badge>
        <span className="text-xs text-muted-foreground">
          MAJ {fmt(report.generatedAt)}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
          Rafraîchir
        </Button>
        <Link
          href="/api/ops/metrics?format=prometheus"
          className="text-xs underline underline-offset-4"
        >
          Export Prometheus
        </Link>
        {report.grafanaUrl ? (
          <a
            href={report.grafanaUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline underline-offset-4"
          >
            Grafana
          </a>
        ) : null}
        <nav className="flex flex-wrap gap-2 text-xs">
          <a href="#alertes" className="underline underline-offset-4">
            Alertes
          </a>
          <a href="#erreurs" className="underline underline-offset-4">
            Erreurs
          </a>
          <a href="#workers" className="underline underline-offset-4">
            Workers
          </a>
          <a href="#smtp" className="underline underline-offset-4">
            SMTP
          </a>
        </nav>
      </div>

      {/* Alertes */}
      <Card id="alertes">
        <CardHeader>
          <CardTitle>Alertes automatiques</CardTitle>
          <CardDescription>
            {report.alerts.length === 0
              ? "Aucune alerte active"
              : `${report.alerts.length} alerte(s) en cours`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tous les seuils sont respectés.
            </p>
          ) : (
            <ul className="space-y-2">
              {report.alerts.map((alert) => (
                <li
                  key={`${alert.id}-${alert.firedAt}`}
                  className="rounded border px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={severityVariant(alert.severity)}>
                      {alert.severity}
                    </Badge>
                    <span className="font-medium">{alert.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {alert.metric}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{alert.message}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Dashboard erreurs */}
      <Card id="erreurs">
        <CardHeader>
          <CardTitle>Dashboard erreurs</CardTitle>
          <CardDescription>
            Échecs / bounces / retries / DLQ — fenêtre{" "}
            {report.email.windowMinutes} min
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Row
            label="Événements KO"
            value={
              errorCount > 0 ? (
                <Badge variant="destructive">{errorCount}</Badge>
              ) : (
                0
              )
            }
          />
          <Row label="Failed" value={report.email.counts?.failed ?? "—"} />
          <Row label="Bounced" value={report.email.counts?.bounced ?? "—"} />
          <Row label="Failure rate" value={pct(report.email.failureRate)} />
          <Row label="Bounce rate" value={pct(report.email.bounceRate)} />
          <Row label="Retries" value={report.email.retries} />
          <Row label="DLQ" value={report.email.dlqDepth} />
          <Row label="Queue waiting" value={report.email.queueWaiting} />
        </CardContent>
      </Card>

      {/* Health + système */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Health Check</CardDescription>
            <CardTitle className="text-base">
              DB {report.health.database ? "OK" : "KO"} · Redis{" "}
              {report.health.redis ? "OK" : "KO"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link href="/api/health/live" className="underline">
              /api/health/live
            </Link>
            {" · "}
            <Link href="/api/health/ready" className="underline">
              /api/health/ready
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>CPU</CardDescription>
            <CardTitle>
              {report.system.cpu.loadPercent ?? "—"}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            load1={report.system.cpu.load1.toFixed(2)} ·{" "}
            {report.system.cpu.cores} cœurs
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>RAM</CardDescription>
            <CardTitle>{report.system.memory.usedPercent}%</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {bytes(report.system.memory.usedBytes)} /{" "}
            {bytes(report.system.memory.totalBytes)} · process{" "}
            {bytes(report.system.memory.processRssBytes)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Process</CardDescription>
            <CardTitle className="text-base">
              uptime {Math.round(report.system.process.uptimeSeconds / 60)} min
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            pid {report.system.process.pid} · {report.system.process.nodeVersion}
          </CardContent>
        </Card>
      </div>

      {/* Métriques email */}
      <Card>
        <CardHeader>
          <CardTitle>Métriques email</CardTitle>
          <CardDescription>
            Fenêtre glissante {report.email.windowMinutes} minutes
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Row label="Emails envoyés" value={report.email.emailsSent} />
          <Row label="Total historique" value={report.email.emailsSentTotal} />
          <Row label="Emails/min" value={report.email.emailsPerMinute} />
          <Row label="Emails/heure" value={report.email.emailsPerHour} />
          <Row
            label="Temps moyen"
            value={
              report.email.avgSendDurationMs === null
                ? "—"
                : `${report.email.avgSendDurationMs} ms`
            }
          />
          <Row label="Retries" value={report.email.retries} />
          <Row label="DLQ" value={report.email.dlqDepth} />
          <Row label="Queue waiting" value={report.email.queueWaiting} />
          <Row label="Bounce Rate" value={pct(report.email.bounceRate)} />
          <Row label="Open Rate" value={pct(report.email.openRate)} />
          <Row label="Reply Rate" value={pct(report.email.replyRate)} />
          <Row label="Failure Rate" value={pct(report.email.failureRate)} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* BullMQ */}
        <Card>
          <CardHeader>
            <CardTitle>BullMQ Dashboard</CardTitle>
            <CardDescription>waiting / active / delayed / failed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {report.queues.map((q) => (
              <div
                key={q.name}
                className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2"
              >
                <span className="font-medium">
                  {q.name}
                  {q.paused ? " (paused)" : ""}
                </span>
                <span className="text-muted-foreground">
                  w={q.waiting} · a={q.active} · d={q.delayed} · f={q.failed} ·
                  c={q.completed}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Redis */}
        <Card>
          <CardHeader>
            <CardTitle>Redis Dashboard</CardTitle>
            <CardDescription>
              {report.redis.connected
                ? `v${report.redis.version ?? "?"} · ${report.redis.role ?? "—"}`
                : "Déconnecté"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Row
              label="Connecté"
              value={report.redis.connected ? "Oui" : "Non"}
            />
            <Row
              label="Mémoire"
              value={report.redis.usedMemoryHuman ?? "—"}
            />
            <Row
              label="Clients"
              value={report.redis.connectedClients ?? "—"}
            />
            <Row label="Ops/s" value={report.redis.opsPerSecond ?? "—"} />
            <Row
              label="Hit rate"
              value={
                report.redis.hitRatePercent === null
                  ? "—"
                  : `${report.redis.hitRatePercent}%`
              }
            />
            <Row
              label="Uptime"
              value={
                report.redis.uptimeSeconds === null
                  ? "—"
                  : `${Math.round(report.redis.uptimeSeconds / 3600)} h`
              }
            />
          </CardContent>
        </Card>

        {/* SMTP */}
        <Card id="smtp">
          <CardHeader>
            <CardTitle>SMTP Dashboard</CardTitle>
            <CardDescription>
              <Link href="/ops/smtp" className="underline underline-offset-4">
                Diagnostic détaillé
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Row label="Provider" value={report.smtp.provider} />
            <Row label="Hôte" value={report.smtp.hostMasked ?? "—"} />
            <Row
              label="Santé"
              value={
                report.smtp.healthy === null
                  ? report.smtp.dryRun
                    ? "N/A (DRY_RUN)"
                    : "non testé"
                  : report.smtp.healthy
                    ? "OK"
                    : "KO"
              }
            />
            <Row label="Dernier test" value={fmt(report.smtp.lastTestAt)} />
            <Row label="Statut" value={report.smtp.status ?? "—"} />
          </CardContent>
        </Card>

        {/* Worker */}
        <Card id="workers">
          <CardHeader>
            <CardTitle>Worker Dashboard</CardTitle>
            <CardDescription>{report.worker.note}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Row
              label="Activé"
              value={report.worker.enabled ? "Oui" : "Non"}
            />
            <Row
              label="Heartbeat"
              value={
                report.worker.stale ? (
                  <Badge variant="destructive">stale</Badge>
                ) : (
                  <Badge>ok</Badge>
                )
              }
            />
            <Row label="Dernier beat" value={fmt(report.worker.heartbeatAt)} />
            <Row
              label="Instances"
              value={report.worker.instanceCount ?? 0}
            />
            <Row label="PID" value={report.worker.pid ?? "—"} />
            <Row label="Hôte" value={report.worker.hostname ?? "—"} />
            <Row
              label="Workers"
              value={
                report.worker.workers.length > 0
                  ? report.worker.workers.join(", ")
                  : "—"
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
