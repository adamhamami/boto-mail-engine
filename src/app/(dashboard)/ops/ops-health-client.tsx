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

interface OpsHealth {
  status: string;
  correlationId?: string;
  timezone: string;
  checks: {
    database: boolean;
    redis: boolean;
    worker: { enabled: boolean; note: string };
    provider: { name: string; healthy: boolean | null; dryRun: boolean };
  };
  queues: Record<
    string,
    { waiting: number; delayed: number; failed: number }
  >;
  metrics: {
    lastSuccessfulSendAt: string | null;
    lastInboundEventAt: string | null;
    retryingAttempts: number;
    recentErrors: Array<{
      id: string;
      at: string;
      type: string;
      campaignId: string | null;
    }>;
    quotas: {
      perHour: number;
      perDay: number;
      usedHourApprox: number | null;
      usedDayApprox: number | null;
    };
  };
  secretsExposed: false;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Africa/Casablanca",
  }).format(new Date(iso));
}

export function OpsHealthClient() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["ops-health"],
    queryFn: () => fetchApi<OpsHealth>("/api/ops/health"),
    refetchInterval: 30_000,
  });

  const report = data?.data;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Chargement de la santé technique…
        </CardContent>
      </Card>
    );
  }

  if (isError || !report) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <p role="alert" className="text-destructive">
            {error instanceof Error
              ? error.message
              : "Impossible de charger /api/ops/health"}
          </p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant={
            report.status === "healthy"
              ? "default"
              : report.status === "degraded"
                ? "secondary"
                : "destructive"
          }
        >
          {report.status}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Fuseau {report.timezone}
        </span>
        {report.correlationId && (
          <span className="font-mono text-xs text-muted-foreground">
            correlationId={report.correlationId}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          secretsExposed={String(report.secretsExposed)}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Base de données</CardDescription>
            <CardTitle>{report.checks.database ? "OK" : "KO"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Redis</CardDescription>
            <CardTitle>{report.checks.redis ? "OK" : "KO"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Worker</CardDescription>
            <CardTitle>
              {report.checks.worker.enabled ? "activé" : "désactivé"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {report.checks.worker.note}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Provider</CardDescription>
            <CardTitle>
              {report.checks.provider.name}
              {report.checks.provider.dryRun ? " · DRY_RUN" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              Santé :{" "}
              {report.checks.provider.healthy === null
                ? "N/A (DRY_RUN)"
                : report.checks.provider.healthy
                  ? "OK"
                  : "KO"}
            </div>
            <div className="flex flex-col gap-1">
              <Link
                href="/ops/smtp"
                className="text-xs underline underline-offset-4"
              >
                Diagnostic SMTP détaillé
              </Link>
              <Link
                href="/ops/dns"
                className="text-xs underline underline-offset-4"
              >
                Vérification DNS (SPF / DKIM / DMARC)
              </Link>
              <Link
                href="/ops/monitoring"
                className="text-xs underline underline-offset-4"
              >
                Monitoring & alertes
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Files BullMQ</CardTitle>
          <CardDescription>Profondeurs waiting / delayed / failed</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          {Object.entries(report.queues).map(([name, counts]) => (
            <div
              key={name}
              className="flex justify-between gap-2 rounded border px-3 py-2"
            >
              <span className="font-medium">{name}</span>
              <span className="text-muted-foreground">
                w={counts.waiting} · d={counts.delayed} · f={counts.failed}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Observabilité</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Dernier envoi réussi</span>
              <span>{fmt(report.metrics.lastSuccessfulSendAt)}</span>
            </div>
            <div className="flex justify-between">
              <span>Dernier événement inbound</span>
              <span>{fmt(report.metrics.lastInboundEventAt)}</span>
            </div>
            <div className="flex justify-between">
              <span>Retries en cours</span>
              <span>{report.metrics.retryingAttempts}</span>
            </div>
            <div className="flex justify-between">
              <span>Quota horaire</span>
              <span>
                {report.metrics.quotas.usedHourApprox ?? "—"} /{" "}
                {report.metrics.quotas.perHour}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Quota journalier</span>
              <span>
                {report.metrics.quotas.usedDayApprox ?? "—"} /{" "}
                {report.metrics.quotas.perDay}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Erreurs récentes</CardTitle>
            <CardDescription>
              campaignId visible — pas de payload sensible
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.metrics.recentErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {report.metrics.recentErrors.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>
                      {e.type}
                      {e.campaignId ? ` · ${e.campaignId.slice(0, 8)}…` : ""}
                    </span>
                    <span className="text-muted-foreground">{fmt(e.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
