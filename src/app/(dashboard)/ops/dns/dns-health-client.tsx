"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi } from "@/lib/api/client";

type DnsStatus = "OK" | "WARNING" | "ERROR";

interface DnsCheck {
  id: string;
  label: string;
  status: DnsStatus;
  summary: string;
  details: string[];
  records: string[];
  durationMs: number;
}

interface DnsHealth {
  generatedAt: string;
  lastTestAt: string;
  durationMs: number;
  cached: boolean;
  domain: string;
  fromEmail: string;
  mailProvider: string;
  smtpHostMasked: string;
  status: DnsStatus;
  checks: DnsCheck[];
  dkimSelectorsTried: string[];
  warnings: string[];
}

const STATUS_LABELS: Record<DnsStatus, string> = {
  OK: "OK",
  WARNING: "WARNING",
  ERROR: "ERROR",
};

function statusVariant(
  status: DnsStatus,
): "default" | "secondary" | "destructive" {
  if (status === "OK") return "default";
  if (status === "ERROR") return "destructive";
  return "secondary";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Africa/Casablanca",
  }).format(date);
}

export function DnsHealthClient() {
  const queryClient = useQueryClient();
  const [domainInput, setDomainInput] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dns-health"],
    queryFn: () => fetchApi<DnsHealth>("/api/ops/dns-health"),
    refetchInterval: 60_000,
  });

  const runTest = useMutation({
    mutationFn: (domain?: string) =>
      fetchApi<DnsHealth>("/api/ops/dns-health", {
        method: "POST",
        body: JSON.stringify(domain ? { domain } : {}),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(["dns-health"], result);
      toast.success(`Test DNS terminé : ${STATUS_LABELS[result.data.status]}`);
    },
    onError: (mutationError: unknown) => {
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : "Le test DNS a échoué",
      );
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Chargement de la santé DNS…
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
              : "Impossible de charger /api/ops/dns-health"}
          </p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  const report = data.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={statusVariant(report.status)}>
          {STATUS_LABELS[report.status]}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Domaine {report.domain}
        </span>
        <span className="text-sm text-muted-foreground">
          Dernier test : {formatDate(report.lastTestAt)}
        </span>
        {report.cached && (
          <span className="text-xs text-muted-foreground">
            (rapport en cache)
          </span>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cible</CardTitle>
          <CardDescription>
            Par défaut : domaine de SMTP_FROM_EMAIL. Surcharge optionnelle pour
            un domaine alternatif.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Email expéditeur</span>
              <span className="font-medium">{report.fromEmail}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Connecteur</span>
              <span className="font-medium">{report.mailProvider}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Hôte SMTP</span>
              <span className="font-medium">{report.smtpHostMasked}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Sélecteurs DKIM</span>
              <span className="font-medium">
                {report.dkimSelectorsTried.join(", ") || "—"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="dns-domain">Domaine (optionnel)</Label>
              <Input
                id="dns-domain"
                placeholder={report.domain}
                value={domainInput}
                onChange={(event) => setDomainInput(event.target.value)}
                autoComplete="off"
              />
            </div>
            <Button
              type="button"
              onClick={() =>
                runTest.mutate(domainInput.trim() || undefined)
              }
              disabled={runTest.isPending}
            >
              {runTest.isPending ? "Vérification…" : "Vérifier maintenant"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {report.checks.map((check) => (
          <Card key={check.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-base">{check.label}</CardTitle>
                <CardDescription>{check.summary}</CardDescription>
              </div>
              <Badge variant={statusVariant(check.status)}>
                {STATUS_LABELS[check.status]}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {check.details.length > 0 && (
                <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                  {check.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
              {check.records.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Enregistrements
                  </p>
                  <ul className="space-y-1 font-mono text-xs break-all">
                    {check.records.map((record) => (
                      <li
                        key={record}
                        className="rounded border px-2 py-1.5"
                      >
                        {record}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Durée {check.durationMs} ms
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
