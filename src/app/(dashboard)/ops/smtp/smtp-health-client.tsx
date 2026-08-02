"use client";

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
import { fetchApi } from "@/lib/api/client";

interface TlsInfo {
  negotiated: boolean;
  mode: string;
  protocol: string | null;
  cipher: string | null;
  authorized: boolean;
  authorizationError: string | null;
}

interface CertificateInfo {
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  expired: boolean;
  fingerprint256: string | null;
  serialNumber: string | null;
  altNames: string[];
}

interface LocalQuota {
  label: string;
  used: number | null;
  limit: number;
  window: string;
}

interface SmtpHealth {
  generatedAt: string;
  lastTestAt: string;
  durationMs: number;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  cached: boolean;
  probeSendsEmail: false;
  connector: {
    id: string;
    label: string;
    hostMasked: string;
    port: number;
    encryption: string;
    requireTls: boolean;
    hostSource: string;
    credentialsConfigured: boolean;
    fromName: string;
    fromEmail: string;
    docsUrl: string;
  };
  connection: {
    reachable: boolean;
    greeting: string | null;
    capabilities: string[];
    starttlsAdvertised: boolean;
    authMechanisms: string[];
    maxMessageBytes: number | null;
    tls: TlsInfo;
  };
  certificate: CertificateInfo | null;
  timings: {
    tcpMs: number | null;
    greetingMs: number | null;
    ehloMs: number | null;
    tlsHandshakeMs: number | null;
    totalMs: number;
    authMs: number | null;
  };
  authentication: {
    status: "ok" | "failed" | "skipped";
    message: string;
    durationMs: number;
  };
  quota: {
    local: LocalQuota[];
    provider: {
      status: string;
      message: string;
      limit: number | null;
      used: number | null;
      remaining: number | null;
      ratePerSecond: number | null;
      window: string | null;
      checkedAt: string;
    };
  };
  gates: {
    dryRun: boolean;
    productionSendingEnabled: boolean;
    allowTestSmtp: boolean;
    nodeEnv: string;
    hostAllowlistConfigured: boolean;
  };
  errors: Array<{ stage: string; code: string; message: string; at: string }>;
  warnings: string[];
}

const STATUS_LABELS: Record<SmtpHealth["status"], string> = {
  healthy: "Opérationnel",
  degraded: "Dégradé",
  unhealthy: "Hors service",
  unknown: "Non testé",
};

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

function formatMs(value: number | null): string {
  return value === null ? "—" : `${value} ms`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function SmtpHealthClient() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["smtp-health"],
    queryFn: () => fetchApi<SmtpHealth>("/api/ops/smtp-health"),
    refetchInterval: 60_000,
  });

  const runTest = useMutation({
    mutationFn: () =>
      fetchApi<SmtpHealth>("/api/ops/smtp-health", { method: "POST" }),
    onSuccess: (result) => {
      queryClient.setQueryData(["smtp-health"], result);
      toast.success(
        `Test terminé : ${STATUS_LABELS[result.data.status].toLowerCase()}`,
      );
    },
    onError: (mutationError: unknown) => {
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : "Le test SMTP a échoué",
      );
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Chargement de la santé SMTP…
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
              : "Impossible de charger /api/ops/smtp-health"}
          </p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  const report = data.data;
  const { connection, certificate, timings, quota } = report;

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
          {STATUS_LABELS[report.status]}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Dernier test : {formatDate(report.lastTestAt)}
        </span>
        {report.cached && (
          <span className="text-xs text-muted-foreground">
            (rapport en cache)
          </span>
        )}
        {report.gates.dryRun && <Badge variant="secondary">DRY_RUN</Badge>}
        <Button
          type="button"
          size="sm"
          onClick={() => runTest.mutate()}
          disabled={runTest.isPending}
        >
          {runTest.isPending ? "Test en cours…" : "Tester maintenant"}
        </Button>
      </div>

      {report.warnings.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Avertissements</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {report.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Connexion</CardTitle>
            <CardDescription>
              {report.connector.label} · hôte masqué par politique de sécurité
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row
              label="Serveur"
              value={`${report.connector.hostMasked}:${report.connector.port}`}
            />
            <Row
              label="Origine de l'hôte"
              value={
                report.connector.hostSource === "preset"
                  ? "preset fournisseur"
                  : "variable d'environnement"
              }
            />
            <Row
              label="Joignable"
              value={connection.reachable ? "Oui" : "Non"}
            />
            <Row label="Bannière" value={connection.greeting ?? "—"} />
            <Row
              label="Identifiants"
              value={
                report.connector.credentialsConfigured
                  ? "configurés"
                  : "absents"
              }
            />
            <Row
              label="Authentification"
              value={
                report.authentication.status === "ok"
                  ? "Acceptée"
                  : report.authentication.status === "failed"
                    ? "Refusée"
                    : "Non testée"
              }
            />
            <p className="pt-1 text-xs text-muted-foreground">
              {report.authentication.message}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Délais</CardTitle>
            <CardDescription>
              Latence par étape de la poignée de main
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Connexion TCP" value={formatMs(timings.tcpMs)} />
            <Row label="Bannière" value={formatMs(timings.greetingMs)} />
            <Row label="EHLO" value={formatMs(timings.ehloMs)} />
            <Row
              label="Poignée de main TLS"
              value={formatMs(timings.tlsHandshakeMs)}
            />
            <Row label="Authentification" value={formatMs(timings.authMs)} />
            <Row label="Total sonde" value={formatMs(timings.totalMs)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Chiffrement</CardTitle>
            <CardDescription>
              Mode configuré : {report.connector.encryption}
              {report.connector.requireTls ? " (TLS exigé)" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row
              label="TLS négocié"
              value={connection.tls.negotiated ? "Oui" : "Non"}
            />
            <Row label="Protocole" value={connection.tls.protocol ?? "—"} />
            <Row label="Suite" value={connection.tls.cipher ?? "—"} />
            <Row
              label="STARTTLS annoncé"
              value={connection.starttlsAdvertised ? "Oui" : "Non"}
            />
            <Row
              label="Mécanismes AUTH"
              value={
                connection.authMechanisms.length > 0
                  ? connection.authMechanisms.join(", ")
                  : "—"
              }
            />
            <Row
              label="Taille max message"
              value={
                connection.maxMessageBytes
                  ? `${Math.round(connection.maxMessageBytes / 1024 / 1024)} Mo`
                  : "—"
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Certificat</CardTitle>
            <CardDescription>
              {connection.tls.authorized
                ? "Chaîne validée"
                : (connection.tls.authorizationError ?? "Non vérifié")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {certificate ? (
              <>
                <Row label="Sujet" value={certificate.subject ?? "—"} />
                <Row label="Émetteur" value={certificate.issuer ?? "—"} />
                <Row
                  label="Valide du"
                  value={formatDate(certificate.validFrom)}
                />
                <Row label="Valide au" value={formatDate(certificate.validTo)} />
                <Row
                  label="Jours restants"
                  value={
                    certificate.daysRemaining === null
                      ? "—"
                      : certificate.expired
                        ? "expiré"
                        : String(certificate.daysRemaining)
                  }
                />
                <Row
                  label="Empreinte SHA-256"
                  value={
                    <span className="font-mono text-xs break-all">
                      {certificate.fingerprint256 ?? "—"}
                    </span>
                  }
                />
              </>
            ) : (
              <p className="text-muted-foreground">
                Aucun certificat — connexion non chiffrée ou serveur injoignable.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quotas locaux</CardTitle>
            <CardDescription>
              Compteurs Redis appliqués à chaque envoi
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {quota.local.length === 0 ? (
              <p className="text-muted-foreground">
                Compteurs indisponibles (Redis injoignable).
              </p>
            ) : (
              quota.local.map((item) => (
                <Row
                  key={item.label}
                  label={`${item.label} (${item.window})`}
                  value={`${item.used ?? "—"} / ${item.limit}`}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quota fournisseur</CardTitle>
            <CardDescription>{quota.provider.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Statut" value={quota.provider.status} />
            <Row
              label="Plafond"
              value={quota.provider.limit ?? "—"}
            />
            <Row label="Consommé" value={quota.provider.used ?? "—"} />
            <Row label="Restant" value={quota.provider.remaining ?? "—"} />
            <Row
              label="Débit max"
              value={
                quota.provider.ratePerSecond === null
                  ? "—"
                  : `${quota.provider.ratePerSecond}/s`
              }
            />
            <Row label="Fenêtre" value={quota.provider.window ?? "—"} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Erreurs du dernier test</CardTitle>
          <CardDescription>
            Messages serveur expurgés de tout identifiant
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.errors.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {report.errors.map((item, index) => (
                <li
                  key={`${item.stage}-${item.code}-${index}`}
                  className="rounded border px-3 py-2"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">
                      {item.stage} · {item.code}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDate(item.at)}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{item.message}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Garde-fous d&apos;envoi</CardTitle>
          <CardDescription>
            Un connecteur sain n&apos;autorise pas à lui seul l&apos;envoi réel
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <Row label="DRY_RUN" value={String(report.gates.dryRun)} />
          <Row
            label="PRODUCTION_SENDING_ENABLED"
            value={String(report.gates.productionSendingEnabled)}
          />
          <Row
            label="ALLOW_TEST_SMTP"
            value={String(report.gates.allowTestSmtp)}
          />
          <Row label="NODE_ENV" value={report.gates.nodeEnv} />
          <Row
            label="Allowlist d'hôtes"
            value={
              report.gates.hostAllowlistConfigured ? "configurée" : "absente"
            }
          />
          <Row
            label="Envoi pendant la sonde"
            value={String(report.probeSendsEmail)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
