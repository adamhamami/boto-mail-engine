"use client";

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
import { fetchApi } from "@/lib/api/client";

interface SettingsData {
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  defaultTimezone: string;
  companyName: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    fromName: string;
    fromEmail: string;
    source: string;
    note: string;
  };
}

type SettingsForm = {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  defaultTimezone: string;
  companyName: string;
};

function settingsToForm(settings: SettingsData): SettingsForm {
  return {
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo ?? "",
    rateLimitWindowMs: settings.rateLimitWindowMs,
    rateLimitMaxRequests: settings.rateLimitMaxRequests,
    defaultTimezone: settings.defaultTimezone,
    companyName: settings.companyName,
  };
}

export function SettingsClient() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SettingsForm | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchApi<SettingsData>("/api/settings"),
  });

  const settings = data?.data;
  const form = draft ?? (settings ? settingsToForm(settings) : null);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!form) {
        throw new Error("Formulaire non prêt");
      }
      return fetchApi<SettingsData>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          fromName: form.fromName,
          fromEmail: form.fromEmail,
          replyTo: form.replyTo || null,
          rateLimitWindowMs: form.rateLimitWindowMs,
          rateLimitMaxRequests: form.rateLimitMaxRequests,
          defaultTimezone: form.defaultTimezone,
          companyName: form.companyName,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Paramètres enregistrés");
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const testSmtpMutation = useMutation({
    mutationFn: () =>
      fetchApi<{ connected: boolean; message: string }>(
        "/api/settings/test-smtp",
        { method: "POST" },
      ),
    onSuccess: (result) => toast.success(result.data.message),
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading || !form) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Chargement des paramètres...
        </CardContent>
      </Card>
    );
  }

  const updateForm = (patch: Partial<SettingsForm>) => {
    setDraft({ ...form, ...patch });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Paramètres généraux</CardTitle>
          <CardDescription>
            Configuration affichée et préférences applicatives.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="companyName">Nom de l&apos;entreprise</Label>
            <Input
              id="companyName"
              value={form.companyName}
              onChange={(e) => updateForm({ companyName: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fromName">Nom expéditeur</Label>
            <Input
              id="fromName"
              value={form.fromName}
              onChange={(e) => updateForm({ fromName: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fromEmail">Email expéditeur</Label>
            <Input
              id="fromEmail"
              type="email"
              value={form.fromEmail}
              onChange={(e) => updateForm({ fromEmail: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="replyTo">Reply-To</Label>
            <Input
              id="replyTo"
              type="email"
              placeholder="optionnel"
              value={form.replyTo}
              onChange={(e) => updateForm({ replyTo: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="timezone">Fuseau horaire</Label>
            <Input
              id="timezone"
              value={form.defaultTimezone}
              onChange={(e) => updateForm({ defaultTimezone: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="rateWindow">Fenêtre rate limit (ms)</Label>
              <Input
                id="rateWindow"
                type="number"
                value={form.rateLimitWindowMs}
                onChange={(e) =>
                  updateForm({ rateLimitWindowMs: Number(e.target.value) })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rateMax">Max requêtes</Label>
              <Input
                id="rateMax"
                type="number"
                value={form.rateLimitMaxRequests}
                onChange={(e) =>
                  updateForm({ rateLimitMaxRequests: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            Enregistrer
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration SMTP</CardTitle>
          <CardDescription>
            Lecture seule — configurée via variables d&apos;environnement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings?.smtp.note && (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              {settings.smtp.note}
            </p>
          )}
          <div className="grid gap-2">
            <Label>Hôte</Label>
            <Input value={settings?.smtp.host ?? ""} readOnly disabled />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Port</Label>
              <Input
                value={settings?.smtp.port ?? ""}
                readOnly
                disabled
              />
            </div>
            <div className="grid gap-2">
              <Label>TLS</Label>
              <Input
                value={settings?.smtp.secure ? "Oui" : "Non"}
                readOnly
                disabled
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Utilisateur</Label>
            <Input value={settings?.smtp.user ?? ""} readOnly disabled />
          </div>
          <div className="grid gap-2">
            <Label>Mot de passe</Label>
            <Input
              value={settings?.smtp.password || "—"}
              readOnly
              disabled
            />
          </div>
          <Button
            variant="outline"
            onClick={() => testSmtpMutation.mutate()}
            disabled={testSmtpMutation.isPending}
          >
            Tester la connexion SMTP
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
