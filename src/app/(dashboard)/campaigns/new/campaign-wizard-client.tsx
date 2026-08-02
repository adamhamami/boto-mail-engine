"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { buildQueryString, fetchApi } from "@/lib/api/client";

const STEPS = [
  "Audience",
  "Séquence",
  "Personnalisation",
  "Calendrier et quotas",
  "Test",
  "Approbation et programmation",
] as const;

interface Segment {
  id: string;
  name: string;
  contactCount: number;
}
interface Template {
  id: string;
  name: string;
  version: number;
}
interface Sequence {
  id: string;
  name: string;
  version: number;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  isTestMode: boolean;
  segmentId: string;
  templateId: string | null;
  sequenceId: string | null;
  settings: Record<string, unknown>;
}

interface Readiness {
  campaignId: string;
  status: string;
  isTestMode: boolean;
  totals: { total: number; eligible: number; excluded: number };
  missingVariables: string[];
  template: { id: string; name: string; version: number } | null;
  sequence: { id: string; name: string; version: number } | null;
  sender: { fromName: string; fromEmail: string };
  sendWindow: {
    timeZone: string;
    startHour: number;
    endHour: number;
    allowedWeekdays: number[];
  };
  quotas: {
    perHour: number;
    perDay: number;
    perConnector: number;
    perSenderDomain: number;
    perCampaign: number;
  };
  connector: { name: string; healthy: boolean | null; dryRun: boolean };
  dryRun: boolean;
  warnings: string[];
  blockingReasons: string[];
  canSubmitForValidation: boolean;
  canSchedule: boolean;
}

export function CampaignWizardClient({
  initialCampaignId,
}: {
  initialCampaignId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [campaignId, setCampaignId] = useState<string | null>(
    initialCampaignId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    segmentId: "",
    sourceType: "sequence" as "template" | "sequence",
    templateId: "",
    sequenceId: "",
    isTestMode: true,
    timeZone: "Africa/Casablanca",
    startHour: 9,
    endHour: 18,
    perHour: 200,
    perDay: 2000,
    scheduledAt: "",
  });

  const { data: segmentsData } = useQuery({
    queryKey: ["segments-wizard"],
    queryFn: () =>
      fetchApi<Segment[]>(
        `/api/segments${buildQueryString({ page: 1, limit: 100 })}`,
      ),
  });
  const { data: templatesData } = useQuery({
    queryKey: ["templates-wizard"],
    queryFn: () =>
      fetchApi<Template[]>(
        `/api/templates${buildQueryString({ page: 1, limit: 100 })}`,
      ),
  });
  const { data: sequencesData } = useQuery({
    queryKey: ["sequences-wizard"],
    queryFn: () =>
      fetchApi<Sequence[]>(
        `/api/sequences${buildQueryString({ page: 1, limit: 100 })}`,
      ),
  });

  const { data: readinessData, refetch: refetchReadiness } = useQuery({
    queryKey: ["campaign-readiness", campaignId],
    queryFn: () => fetchApi<Readiness>(`/api/campaigns/${campaignId}/readiness`),
    enabled: Boolean(campaignId) && step >= 4,
  });

  const readiness = readinessData?.data;

  const createOrUpdate = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        segmentId: form.segmentId,
        templateId: form.sourceType === "template" ? form.templateId : null,
        sequenceId: form.sourceType === "sequence" ? form.sequenceId : null,
        isTestMode: form.isTestMode,
        settings: {
          timeZone: form.timeZone,
          sendWindow: {
            timeZone: form.timeZone,
            startHour: form.startHour,
            endHour: form.endHour,
            allowedWeekdays: [1, 2, 3, 4, 5],
          },
          quotas: {
            perHour: form.perHour,
            perDay: form.perDay,
          },
        },
      };

      if (campaignId) {
        return fetchApi<Campaign>(`/api/campaigns/${campaignId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      return fetchApi<Campaign>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (res) => {
      setCampaignId(res.data.id);
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  async function persistAndNext() {
    if (busy) return;
    setBusy(true);
    try {
      if (step <= 3) {
        if (!form.name.trim() || !form.segmentId) {
          toast.error("Nom et audience (segment) sont obligatoires");
          return;
        }
        if (form.sourceType === "template" && !form.templateId) {
          toast.error("Sélectionnez un modèle");
          return;
        }
        if (form.sourceType === "sequence" && !form.sequenceId) {
          toast.error("Sélectionnez une séquence");
          return;
        }
        await createOrUpdate.mutateAsync();
        toast.success(campaignId ? "Campagne mise à jour" : "Campagne créée");
      }
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (campaignId || step <= 3) {
        await refetchReadiness();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function runTestSend() {
    if (!campaignId || busy) return;
    setBusy(true);
    try {
      await fetchApi(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        body: JSON.stringify({ isTestMode: true }),
      });
      await fetchApi(`/api/campaigns/${campaignId}/schedule`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success("Envoi test lancé (contrôles serveur appliqués)");
      await refetchReadiness();
      void queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec du test");
    } finally {
      setBusy(false);
    }
  }

  async function submitValidation() {
    if (!campaignId || busy) return;
    if (!window.confirm("Soumettre la campagne pour validation ?")) return;
    setBusy(true);
    try {
      await fetchApi(`/api/campaigns/${campaignId}/submit`, { method: "POST" });
      toast.success("Soumise pour validation");
      await refetchReadiness();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  async function approveAndSchedule() {
    if (!campaignId || busy) return;
    if (
      !window.confirm(
        "Valider puis programmer cette campagne ? Les contrôles serveur s'appliquent.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await fetchApi(`/api/campaigns/${campaignId}/validate`, {
        method: "POST",
      });
      await fetchApi(`/api/campaigns/${campaignId}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          scheduledAt: form.scheduledAt
            ? new Date(form.scheduledAt).toISOString()
            : undefined,
        }),
      });
      toast.success("Campagne validée et programmée");
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      router.push(`/campaigns/${campaignId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec programmation");
    } finally {
      setBusy(false);
    }
  }

  const segments = segmentsData?.data ?? [];
  const templates = templatesData?.data ?? [];
  const sequences = sequencesData?.data ?? [];

  return (
    <div className="space-y-6">
      <nav aria-label="Étapes assistant" className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm ${
              i === step
                ? "bg-teal-700 text-white"
                : i < step
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground"
            }`}
            onClick={() => {
              if (i <= step) setStep(i);
            }}
            aria-current={i === step ? "step" : undefined}
          >
            {i + 1}. {label}
          </button>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]}</CardTitle>
          <CardDescription>
            Les actions sensibles passent par les API serveur (aucun contournement UI).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="name">Nom de la campagne</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Audience (segment)</Label>
                <Select
                  value={form.segmentId}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, segmentId: v ?? "" }))
                  }
                >
                  <SelectTrigger aria-label="Segment">
                    <SelectValue placeholder="Choisir un segment" />
                  </SelectTrigger>
                  <SelectContent>
                    {segments.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.contactCount ?? 0})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Source</Label>
                <Select
                  value={form.sourceType}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      sourceType: (v as "template" | "sequence") ?? "sequence",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sequence">Séquence (recommandé)</SelectItem>
                    <SelectItem value="template">Modèle unique</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.sourceType === "sequence" ? (
                <div className="space-y-2">
                  <Label>Séquence</Label>
                  <Select
                    value={form.sequenceId}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, sequenceId: v ?? "" }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir" />
                    </SelectTrigger>
                    <SelectContent>
                      {sequences.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} · v{s.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Modèle</Label>
                  <Select
                    value={form.templateId}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, templateId: v ?? "" }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} · v{t.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3 text-sm">
              <p>
                La personnalisation utilise les variables du modèle (
                <code>{"{{prenom}}"}</code>, organisation, etc.). Les variables
                manquantes sont détectées côté serveur avant envoi.
              </p>
              <p className="text-muted-foreground">
                Mode test recommandé : envoi limité allowlist, préfixe [TEST/DRY_RUN].
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isTestMode}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, isTestMode: e.target.checked }))
                  }
                />
                Mode test (isTestMode)
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tz">Fuseau</Label>
                <Input
                  id="tz"
                  value={form.timeZone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, timeZone: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="start">Heure début</Label>
                <Input
                  id="start"
                  type="number"
                  min={0}
                  max={23}
                  value={form.startHour}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      startHour: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end">Heure fin</Label>
                <Input
                  id="end"
                  type="number"
                  min={1}
                  max={24}
                  value={form.endHour}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      endHour: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qh">Quota horaire</Label>
                <Input
                  id="qh"
                  type="number"
                  value={form.perHour}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      perHour: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qd">Quota journalier</Label>
                <Input
                  id="qd"
                  type="number"
                  value={form.perDay}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      perDay: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              {!campaignId ? (
                <p className="text-sm text-destructive" role="alert">
                  Enregistrez d&apos;abord les étapes précédentes.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Lance un schedule en mode test. Les gates serveur (DRY_RUN,
                    allowlist, quotas) s&apos;appliquent.
                  </p>
                  <Button
                    type="button"
                    onClick={() => void runTestSend()}
                    disabled={busy}
                  >
                    {busy ? "En cours…" : "Lancer l'envoi test"}
                  </Button>
                </>
              )}
            </div>
          )}

          {step === 5 && readiness && (
            <div className="space-y-4">
              <dl className="grid gap-2 text-sm md:grid-cols-2">
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>Total segment</dt>
                  <dd>{readiness.totals.total}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>Éligibles</dt>
                  <dd>{readiness.totals.eligible}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>Exclus</dt>
                  <dd>{readiness.totals.excluded}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>Variables manquantes</dt>
                  <dd>
                    {readiness.missingVariables.length
                      ? readiness.missingVariables.join(", ")
                      : "aucune"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>Template</dt>
                  <dd>
                    {readiness.template
                      ? `${readiness.template.name} v${readiness.template.version}`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>Séquence</dt>
                  <dd>
                    {readiness.sequence
                      ? `${readiness.sequence.name} v${readiness.sequence.version}`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>Expéditeur</dt>
                  <dd>
                    {readiness.sender.fromName} &lt;{readiness.sender.fromEmail}
                    &gt;
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>Créneaux</dt>
                  <dd>
                    {readiness.sendWindow.startHour}h–
                    {readiness.sendWindow.endHour}h (
                    {readiness.sendWindow.timeZone})
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>Quotas</dt>
                  <dd>
                    {readiness.quotas.perHour}/h · {readiness.quotas.perDay}/j
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>Connecteur</dt>
                  <dd>
                    {readiness.connector.name}
                    {readiness.connector.healthy === false ? " (KO)" : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b py-1">
                  <dt>DRY_RUN</dt>
                  <dd>{readiness.dryRun ? "oui" : "non"}</dd>
                </div>
              </dl>

              {readiness.warnings.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  <p className="font-medium">Avertissements</p>
                  <ul className="mt-1 list-disc pl-5">
                    {readiness.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {readiness.blockingReasons.length > 0 && (
                <div
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                  role="alert"
                >
                  <p className="font-medium">Blocages</p>
                  <ul className="mt-1 list-disc pl-5">
                    {readiness.blockingReasons.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="sched">Programmation (optionnel)</Label>
                <Input
                  id="sched"
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, scheduledAt: e.target.value }))
                  }
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || readiness.blockingReasons.length > 0}
                  onClick={() => void submitValidation()}
                >
                  Soumettre validation
                </Button>
                <Button
                  type="button"
                  disabled={busy || readiness.blockingReasons.length > 0}
                  onClick={() => void approveAndSchedule()}
                >
                  Valider et programmer
                </Button>
              </div>
            </div>
          )}

          {step === 5 && !readiness && campaignId && (
            <p className="text-sm text-muted-foreground">Chargement du récapitulatif…</p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0 || busy}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Précédent
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() => void persistAndNext()}
          >
            {busy ? "Enregistrement…" : "Suivant"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => campaignId && router.push(`/campaigns/${campaignId}`)}
            disabled={!campaignId}
          >
            Voir la campagne
          </Button>
        )}
      </div>
    </div>
  );
}
