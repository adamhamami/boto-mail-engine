"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/api/client";

interface DashboardStats {
  contactsImported: number;
  contactsEligible: number;
  emailsSent: number;
  emailsDelivered: number;
  replies: number;
  positiveReplies: number;
  demoRequests: number;
  openRate: number;
  bounces: number;
  unsubscribes: number;
  salesTasksOpen: number;
  activeCampaigns: number;
  totalContacts: number;
  quotaHourly: { limit: number; used: number | null };
  quotaDaily: { limit: number; used: number | null };
  queueWaiting: number;
  dlqDepth: number;
  lastEventAt: string | null;
  lastEventType: string | null;
  recentErrors: Array<{
    id: string;
    at: string;
    type: string;
    campaignId: string | null;
  }>;
  connector: {
    name: string;
    dryRun: boolean;
    healthy: boolean | null;
  };
  timezone: string;
  recentCampaigns: Array<{
    id: string;
    name: string;
    status: string;
    sentCount: number;
    openCount: number;
    replyCount: number;
    createdAt: string;
  }>;
  chartData: Array<{
    date: string;
    sent: number;
    opens: number;
    replies: number;
  }>;
}

const campaignStatusLabels: Record<string, string> = {
  DRAFT: "Brouillon",
  TESTED: "Testée",
  PENDING_VALIDATION: "En validation",
  VALIDATED: "Validée",
  SCHEDULED: "Planifiée",
  RUNNING: "En cours",
  PAUSED: "En pause",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  FAILED: "Échouée",
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function formatCasablanca(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Africa/Casablanca",
  }).format(new Date(iso));
}

function ChartBars({
  data,
  field,
  color,
  label,
}: {
  data: DashboardStats["chartData"];
  field: "sent" | "opens" | "replies";
  color: string;
  label: string;
}) {
  const max = Math.max(...data.map((d) => d[field]), 1);
  const recent = data.slice(-14);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex h-24 items-end gap-1" role="img" aria-label={label}>
        {recent.map((point) => {
          const height = Math.max((point[field] / max) * 100, 4);
          return (
            <div
              key={point.date}
              className="group relative flex-1"
              title={`${new Date(point.date).toLocaleDateString("fr-FR")}: ${point[field]}`}
            >
              <div
                className={`w-full rounded-t ${color}`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">14 derniers jours</p>
    </div>
  );
}

export function DashboardClient() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetchApi<DashboardStats>("/api/dashboard/stats"),
    retry: 1,
    refetchInterval: 60_000,
  });

  const stats = data?.data;

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Chargement">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <p className="text-muted-foreground">
            Impossible de charger les statistiques du tableau de bord.
          </p>
          {error instanceof Error && (
            <p className="text-sm text-destructive" role="alert">
              {error.message}
            </p>
          )}
          <button
            type="button"
            className="text-sm text-teal-600 underline underline-offset-2"
            onClick={() => void refetch()}
          >
            Réessayer
          </button>
        </CardContent>
      </Card>
    );
  }

  const kpis = [
    {
      title: "Contacts importés",
      value: formatNumber(stats.contactsImported),
      description: "IMPORTED / TO_REVIEW",
    },
    {
      title: "Contacts éligibles",
      value: formatNumber(stats.contactsEligible),
      description: "Prêts pour envoi",
    },
    {
      title: "Envoyés",
      value: formatNumber(stats.emailsSent),
      description: "Tentatives SENT",
    },
    {
      title: "Délivrés",
      value: formatNumber(stats.emailsDelivered),
      description: "Événements DELIVERED",
    },
    {
      title: "Rebonds",
      value: formatNumber(stats.bounces),
      description: "Rejets cumulés",
    },
    {
      title: "Réponses",
      value: formatNumber(stats.replies),
      description: "Toutes réponses",
    },
    {
      title: "Réponses positives",
      value: formatNumber(stats.positiveReplies),
      description: "Classification positive",
    },
    {
      title: "Désinscriptions",
      value: formatNumber(stats.unsubscribes),
      description: "Opt-out",
    },
    {
      title: "Demandes de démo",
      value: formatNumber(stats.demoRequests),
      description: "Tâches DEMO ouvertes",
    },
    {
      title: "Tâches commerciales",
      value: formatNumber(stats.salesTasksOpen),
      description: "Ouvertes / en cours",
    },
    {
      title: "Campagnes actives",
      value: formatNumber(stats.activeCampaigns),
      description: "RUNNING / SCHEDULED",
    },
    {
      title: "File / DLQ",
      value: `${formatNumber(stats.queueWaiting)} / ${formatNumber(stats.dlqDepth)}`,
      description: "En attente · dead-letter",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Fuseau {stats.timezone}</span>
        <span aria-hidden>·</span>
        <span>
          Connecteur {stats.connector.name}
          {stats.connector.dryRun ? " (DRY_RUN)" : ""}
          {stats.connector.healthy === false ? " — non sain" : ""}
        </span>
        <span aria-hidden>·</span>
        <span>
          Dernier événement : {stats.lastEventType ?? "—"} (
          {formatCasablanca(stats.lastEventAt)})
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{kpi.title}</CardTitle>
              <CardDescription>{kpi.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tracking-tight">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quotas</CardTitle>
            <CardDescription>Africa/Casablanca</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Horaire</span>
              <span>
                {stats.quotaHourly.used ?? "—"} / {stats.quotaHourly.limit}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Journalier</span>
              <span>
                {stats.quotaDaily.used ?? "—"} / {stats.quotaDaily.limit}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Erreurs récentes</CardTitle>
            <CardDescription>Rebonds / erreurs provider</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.recentErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune erreur récente</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {stats.recentErrors.slice(0, 5).map((err) => (
                  <li key={err.id} className="flex justify-between gap-2">
                    <span>{err.type}</span>
                    <span className="text-muted-foreground">
                      {formatCasablanca(err.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/ops"
              className="mt-3 inline-block text-sm text-teal-700 underline-offset-2 hover:underline"
            >
              Santé technique
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Activité (30 jours)</CardTitle>
            <CardDescription>
              Envois, ouvertures et réponses par jour
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-3">
            <ChartBars
              data={stats.chartData}
              field="sent"
              color="bg-teal-500"
              label="Envois"
            />
            <ChartBars
              data={stats.chartData}
              field="opens"
              color="bg-blue-500"
              label="Ouvertures"
            />
            <ChartBars
              data={stats.chartData}
              field="replies"
              color="bg-amber-500"
              label="Réponses"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Campagnes récentes</CardTitle>
            <CardDescription>Les 5 dernières campagnes</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.recentCampaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune campagne</p>
            ) : (
              <ul className="space-y-3">
                {stats.recentCampaigns.map((campaign) => (
                  <li
                    key={campaign.id}
                    className="rounded-lg border p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="font-medium hover:underline"
                      >
                        {campaign.name}
                      </Link>
                      <Badge variant="secondary">
                        {campaignStatusLabels[campaign.status] ?? campaign.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatNumber(campaign.sentCount)} envois ·{" "}
                      {formatNumber(campaign.openCount)} ouvertures ·{" "}
                      {formatNumber(campaign.replyCount)} réponses
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Détail journalier</CardTitle>
          <CardDescription>10 derniers jours</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Envois</TableHead>
                <TableHead className="text-right">Ouvertures</TableHead>
                <TableHead className="text-right">Réponses</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...stats.chartData]
                .reverse()
                .slice(0, 10)
                .map((row) => (
                  <TableRow key={row.date}>
                    <TableCell>
                      {new Date(row.date).toLocaleDateString("fr-FR")}
                    </TableCell>
                    <TableCell className="text-right">{row.sent}</TableCell>
                    <TableCell className="text-right">{row.opens}</TableCell>
                    <TableCell className="text-right">{row.replies}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
