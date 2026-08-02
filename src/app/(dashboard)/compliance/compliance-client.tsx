"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { buildQueryString, fetchApi } from "@/lib/api/client";

interface Policy {
  framework: string[];
  controller: { name: string; email: string | null };
  rights: string[];
  retention: {
    enabled: boolean;
    softDeleteAnonymizeDays: number;
    auditLogDays: number;
    eventDays: number;
  };
  notes: string[];
}

interface DataSubjectRequest {
  id: string;
  type: string;
  status: string;
  email: string;
  dueAt: string;
  createdAt: string;
  contact: {
    id: string;
    email: string;
    legalHold: boolean;
    anonymizedAt: string | null;
  } | null;
}

const typeLabels: Record<string, string> = {
  ACCESS: "Accès",
  EXPORT: "Export",
  RECTIFICATION: "Rectification",
  ERASURE: "Effacement",
  OBJECTION: "Opposition",
  RESTRICTION: "Limitation",
};

const statusLabels: Record<string, string> = {
  RECEIVED: "Reçue",
  IN_PROGRESS: "En cours",
  COMPLETED: "Clôturée",
  REJECTED: "Rejetée",
  CANCELLED: "Annulée",
};

export function ComplianceClient() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [email, setEmail] = useState("");
  const [type, setType] = useState("ACCESS");
  const [notes, setNotes] = useState("");
  const [contactId, setContactId] = useState("");
  const [anonReason, setAnonReason] = useState("");

  const { data: policyData } = useQuery({
    queryKey: ["compliance-policy"],
    queryFn: () => fetchApi<Policy>("/api/compliance/policy"),
  });

  const { data: requestsData, isLoading } = useQuery({
    queryKey: ["compliance-requests", page],
    queryFn: () =>
      fetchApi<DataSubjectRequest[]>(
        `/api/compliance/requests${buildQueryString({ page, limit: 20 })}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      fetchApi("/api/compliance/requests", {
        method: "POST",
        body: JSON.stringify({
          type,
          email,
          notes: notes || undefined,
          contactId: contactId || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Demande enregistrée");
      setEmail("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["compliance-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retentionMutation = useMutation({
    mutationFn: (dryRun: boolean) =>
      fetchApi("/api/compliance/retention/run", {
        method: "POST",
        body: JSON.stringify({ confirm: "retention", dryRun }),
      }),
    onSuccess: (res) => {
      toast.success(
        res.data && typeof res.data === "object"
          ? `Rétention OK (dryRun=${String((res.data as { dryRun?: boolean }).dryRun)})`
          : "Rétention exécutée",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function exportSubject() {
    if (!contactId) {
      toast.error("Indiquez un contactId");
      return;
    }
    try {
      const response = await fetch(
        `/api/compliance/contacts/${contactId}/export`,
      );
      if (!response.ok) {
        const json = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(json.error?.message ?? "Export échoué");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `subject-export-${contactId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Export JSON téléchargé");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export échoué");
    }
  }

  async function anonymizeSubject() {
    if (!contactId || !anonReason.trim()) {
      toast.error("contactId + motif requis");
      return;
    }
    if (
      !window.confirm(
        "Anonymisation IRRÉVERSIBLE. Confirmer l’effacement CNDP ?",
      )
    ) {
      return;
    }
    try {
      await fetchApi(`/api/compliance/contacts/${contactId}/anonymize`, {
        method: "POST",
        body: JSON.stringify({
          confirm: "anonymize",
          reason: anonReason,
        }),
      });
      toast.success("Contact anonymisé");
      void qc.invalidateQueries({ queryKey: ["compliance-requests"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Anonymisation échouée");
    }
  }

  const policy = policyData?.data;
  const requests = requestsData?.data ?? [];
  const meta = requestsData?.meta as
    | { hasNext?: boolean; hasPrev?: boolean }
    | undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Politique</CardTitle>
          <CardDescription>
            Cadre {policy?.framework.join(" · ") ?? "…"} — responsable{" "}
            {policy?.controller.name ?? "…"}
            {policy?.controller.email ? ` (${policy.controller.email})` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {(policy?.rights ?? []).map((r) => (
              <Badge key={r} variant="secondary">
                {r}
              </Badge>
            ))}
          </div>
          {policy && (
            <p className="text-muted-foreground">
              Rétention auto :{" "}
              {policy.retention.enabled ? "activée" : "désactivée"} — soft-delete{" "}
              {policy.retention.softDeleteAnonymizeDays}j · events{" "}
              {policy.retention.eventDays}j · audit {policy.retention.auditLogDays}
              j
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {(policy?.notes ?? []).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Nouvelle demande</CardTitle>
            <CardDescription>
              Traçabilité personne concernée (délai indicatif 30 j)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(typeLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="personne@example.com"
              />
            </div>
            <div className="space-y-1">
              <Label>ContactId (optionnel)</Label>
              <Input
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                placeholder="cuid…"
              />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!email || createMutation.isPending}
            >
              Enregistrer la demande
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions sur contact</CardTitle>
            <CardDescription>
              Export portable JSON · Anonymisation · Rétention
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>ContactId</Label>
              <Input
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                placeholder="cuid du contact"
              />
            </div>
            <Button variant="outline" onClick={() => void exportSubject()}>
              Exporter (JSON)
            </Button>
            <div className="space-y-1">
              <Label>Motif anonymisation</Label>
              <Textarea
                value={anonReason}
                onChange={(e) => setAnonReason(e.target.value)}
                rows={2}
                placeholder="Demande effacement CNDP n°…"
              />
            </div>
            <Button variant="destructive" onClick={() => void anonymizeSubject()}>
              Anonymiser
            </Button>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={() => retentionMutation.mutate(true)}
                disabled={retentionMutation.isPending}
              >
                Rétention (dry-run)
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (
                    window.confirm(
                      "Exécuter la rétention réelle (anonymisations + purges) ?",
                    )
                  ) {
                    retentionMutation.mutate(false);
                  }
                }}
                disabled={retentionMutation.isPending}
              >
                Rétention (réel)
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Demandes</CardTitle>
          <CardDescription>Journal des demandes personnes concernées</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Contact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{typeLabels[r.type] ?? r.type}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {statusLabels[r.status] ?? r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.email}</TableCell>
                    <TableCell className="text-xs">
                      {new Date(r.dueAt).toLocaleDateString("fr-MA")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.contact ? (
                        <span>
                          {r.contact.id.slice(0, 8)}…
                          {r.contact.legalHold ? " · hold" : ""}
                          {r.contact.anonymizedAt ? " · anon" : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {requests.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      Aucune demande
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
