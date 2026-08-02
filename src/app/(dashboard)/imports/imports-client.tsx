"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildQueryString, fetchApi } from "@/lib/api/client";
import { IMPORT_TARGET_FIELDS } from "@/lib/imports/mapping";

interface ImportBatch {
  id: string;
  filename: string;
  mimeType: string;
  status: string;
  totalRows: number;
  processedRows: number;
  successRows: number;
  errorRows: number;
  duplicateRows: number;
  rejectedRows?: number;
  suppressedRows?: number;
  headers?: string[];
  suggestedMapping?: Record<string, string | null>;
  createdAt: string;
}

const statusLabels: Record<string, string> = {
  PENDING: "En attente",
  PROCESSING: "En cours",
  COMPLETED: "Terminé",
  FAILED: "Échoué",
  PARTIAL: "Partiel",
};

const fieldLabels: Record<string, string> = {
  email: "Email *",
  firstName: "Prénom",
  lastName: "Nom",
  phone: "Téléphone",
  jobTitle: "Poste",
  city: "Ville",
  organizationName: "Organisation",
  establishmentType: "Type établissement",
  organizationSize: "Taille",
  tags: "Tags",
  source: "Source",
  consentBase: "Base légale",
};

type Step = "upload" | "mapping" | "preview" | "done";

export function ImportsClient() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [preview, setPreview] = useState<{
    preview: Array<{
      row: number;
      valid: boolean;
      error: string | null;
      data: { email: string } | null;
    }>;
    invalidInPreview: number;
    totalRows: number;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["imports"],
    queryFn: () =>
      fetchApi<ImportBatch[]>(
        `/api/imports${buildQueryString({ page: 1, limit: 50 })}`,
      ),
    refetchInterval: (query) => {
      const items = query.state.data?.data ?? [];
      return items.some(
        (i: ImportBatch) =>
          i.status === "PROCESSING" || i.status === "PENDING",
      )
        ? 3000
        : false;
    },
  });

  const headers = useMemo(
    () => batch?.headers ?? Object.keys(mapping),
    [batch, mapping],
  );

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Sélectionnez un fichier CSV ou XLSX");
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/imports/upload", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: ImportBatch;
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        throw new Error(json.error?.message ?? "Upload échoué");
      }
      return json.data;
    },
    onSuccess: (created) => {
      setBatch(created);
      setMapping(created.suggestedMapping ?? {});
      setStep("mapping");
      toast.success("Fichier validé — mappez les colonnes");
      void queryClient.invalidateQueries({ queryKey: ["imports"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const mappingMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/imports/${batch!.id}/mapping`, {
        method: "POST",
        body: JSON.stringify({ mapping }),
      }),
    onSuccess: async () => {
      const p = await fetchApi<{
        preview: Array<{
          row: number;
          valid: boolean;
          error: string | null;
          data: { email: string } | null;
        }>;
        invalidInPreview: number;
        totalRows: number;
      }>(`/api/imports/${batch!.id}/preview?limit=20`);
      setPreview(p.data);
      setStep("preview");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/imports/${batch!.id}/confirm`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Import lancé en arrière-plan");
      setStep("done");
      setOpen(false);
      resetWizard();
      void queryClient.invalidateQueries({ queryKey: ["imports"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function resetWizard() {
    setStep("upload");
    setFile(null);
    setBatch(null);
    setMapping({});
    setPreview(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Imports</h1>
          <p className="text-muted-foreground text-sm">
            CSV / XLSX — mapping, aperçu, traitement asynchrone (R-01)
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) resetWizard();
          }}
        >
          <DialogTrigger asChild>
            <Button>Nouvel import</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {step === "upload" && "1. Fichier"}
                {step === "mapping" && "2. Mapping colonnes"}
                {step === "preview" && "3. Aperçu & confirmation"}
                {step === "done" && "Terminé"}
              </DialogTitle>
            </DialogHeader>

            {step === "upload" && (
              <div className="space-y-3">
                <Label htmlFor="file">Fichier CSV ou XLSX</Label>
                <Input
                  id="file"
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-muted-foreground text-xs">
                  Taille et nombre de lignes limités côté serveur. Aucune formule
                  n’est exécutée.
                </p>
              </div>
            )}

            {step === "mapping" && (
              <div className="space-y-3">
                <p className="text-sm">
                  {batch?.totalRows ?? 0} lignes · {headers.length} colonnes
                </p>
                {headers.map((header) => (
                  <div key={header} className="grid grid-cols-2 gap-2">
                    <Label className="truncate pt-2 text-xs">{header}</Label>
                    <select
                      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                      value={mapping[header] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m,
                          [header]: e.target.value || null,
                        }))
                      }
                    >
                      <option value="">— ignorer —</option>
                      {IMPORT_TARGET_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {fieldLabels[f] ?? f}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {step === "preview" && preview && (
              <div className="space-y-3">
                <p className="text-sm">
                  Aperçu {preview.preview.length}/{preview.totalRows} —{" "}
                  {preview.invalidInPreview} invalide(s) dans l’échantillon
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ligne</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.preview.map((row) => (
                      <TableRow key={row.row}>
                        <TableCell>{row.row}</TableCell>
                        <TableCell>{row.data?.email ?? "—"}</TableCell>
                        <TableCell>
                          {row.valid ? "OK" : row.error}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <DialogFooter>
              {step === "upload" && (
                <Button
                  disabled={!file || uploadMutation.isPending}
                  onClick={() => uploadMutation.mutate()}
                >
                  Valider le fichier
                </Button>
              )}
              {step === "mapping" && (
                <Button
                  disabled={mappingMutation.isPending}
                  onClick={() => mappingMutation.mutate()}
                >
                  Aperçu
                </Button>
              )}
              {step === "preview" && (
                <Button
                  disabled={confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate()}
                >
                  Confirmer & traiter
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historique</CardTitle>
          <CardDescription>
            Progression rafraîchie automatiquement pendant le traitement worker.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Chargement…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fichier</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Progression</TableHead>
                  <TableHead>OK / rejet / doublon</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.data ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.filename}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {statusLabels[item.status] ?? item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {item.processedRows}/{item.totalRows}
                    </TableCell>
                    <TableCell className="text-sm">
                      {item.successRows} / {item.rejectedRows ?? item.errorRows}{" "}
                      / {item.duplicateRows}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
