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
import { Textarea } from "@/components/ui/textarea";
import { buildQueryString, fetchApi } from "@/lib/api/client";
import { sanitizePreviewHtml } from "@/lib/security/html-preview";

interface Template {
  id: string;
  name: string;
  subject: string;
  /** Présent sur create/detail ; absent de la liste légère */
  bodyHtml?: string;
  bodyText?: string | null;
  variables: string[];
  isActive: boolean;
  createdAt: string;
}

interface PreviewResult {
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
}

export function TemplatesClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [form, setForm] = useState({
    name: "",
    subject: "",
    bodyHtml: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["templates", search],
    queryFn: () =>
      fetchApi<Template[]>(
        `/api/templates${buildQueryString({ search, page: 1, limit: 50 })}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      fetchApi<Template>("/api/templates", {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      toast.success("Modèle créé");
      setOpen(false);
      setForm({ name: "", subject: "", bodyHtml: "" });
      void queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetchApi<Template>(`/api/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Modèle supprimé");
      void queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const previewMutation = useMutation({
    mutationFn: (id: string) =>
      fetchApi<PreviewResult>(`/api/templates/${id}/preview`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (result) => {
      setPreviewData(result.data);
      setPreviewOpen(true);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const templates = data?.data ?? [];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Modèles d&apos;email</CardTitle>
            <CardDescription>
              Créez et gérez vos modèles avec variables dynamiques.
            </CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>Nouveau modèle</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Créer un modèle</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nom</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="subject">Objet</Label>
                  <Input
                    id="subject"
                    placeholder="Bonjour {{firstName}}..."
                    value={form.subject}
                    onChange={(e) =>
                      setForm({ ...form, subject: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="bodyHtml">Corps HTML</Label>
                  <Textarea
                    id="bodyHtml"
                    rows={8}
                    placeholder="<p>Bonjour {{firstName}} {{lastName}},</p>"
                    value={form.bodyHtml}
                    onChange={(e) =>
                      setForm({ ...form, bodyHtml: e.target.value })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={
                    !form.name ||
                    !form.subject ||
                    !form.bodyHtml ||
                    createMutation.isPending
                  }
                >
                  Créer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Rechercher un modèle..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Variables</TableHead>
                <TableHead>Créé le</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Chargement...
                  </TableCell>
                </TableRow>
              ) : templates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Aucun modèle trouvé
                  </TableCell>
                </TableRow>
              ) : (
                templates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell>{template.subject}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {template.variables.slice(0, 3).map((v) => (
                          <Badge key={v} variant="secondary">
                            {`{{${v}}}`}
                          </Badge>
                        ))}
                        {template.variables.length > 3 && (
                          <Badge variant="outline">
                            +{template.variables.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(template.createdAt).toLocaleDateString("fr-FR")}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => previewMutation.mutate(template.id)}
                      >
                        Aperçu
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(template.id)}
                      >
                        Supprimer
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Aperçu du modèle</DialogTitle>
          </DialogHeader>
          {previewData && (
            <div className="space-y-4">
              <div>
                <Label>Objet</Label>
                <p className="mt-1 rounded-md border p-2 text-sm">
                  {previewData.subject}
                </p>
              </div>
              <div>
                <Label>Corps HTML</Label>
                <iframe
                  title="Aperçu HTML sécurisé"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  className="mt-1 h-64 w-full rounded-md border bg-white"
                  srcDoc={sanitizePreviewHtml(previewData.bodyHtml)}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
