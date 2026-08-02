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

interface Template {
  id: string;
  name: string;
}

interface SequenceStep {
  id: string;
  stepOrder: number;
  type: "EMAIL" | "DELAY";
  templateId: string | null;
  delayDays: number;
  delayHours: number;
  template: { id: string; name: string; subject: string } | null;
}

interface Sequence {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  steps: SequenceStep[];
  createdAt: string;
}

interface StepForm {
  stepOrder: number;
  type: "EMAIL" | "DELAY";
  templateId: string;
  delayDays: number;
  delayHours: number;
}

export function SequencesClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [steps, setSteps] = useState<StepForm[]>([
    { stepOrder: 0, type: "EMAIL", templateId: "", delayDays: 0, delayHours: 0 },
  ]);

  const { data, isLoading } = useQuery({
    queryKey: ["sequences", search],
    queryFn: () =>
      fetchApi<Sequence[]>(
        `/api/sequences${buildQueryString({ search, page: 1, limit: 50 })}`,
      ),
  });

  const { data: templatesData } = useQuery({
    queryKey: ["templates-for-sequences"],
    queryFn: () =>
      fetchApi<Template[]>(
        `/api/templates${buildQueryString({ page: 1, limit: 100 })}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      fetchApi<Sequence>("/api/sequences", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          steps: steps.map((step) => ({
            stepOrder: step.stepOrder,
            type: step.type,
            templateId: step.type === "EMAIL" ? step.templateId : null,
            delayDays: step.delayDays,
            delayHours: step.delayHours,
          })),
        }),
      }),
    onSuccess: () => {
      toast.success("Séquence créée");
      setOpen(false);
      setForm({ name: "", description: "" });
      setSteps([
        { stepOrder: 0, type: "EMAIL", templateId: "", delayDays: 0, delayHours: 0 },
      ]);
      void queryClient.invalidateQueries({ queryKey: ["sequences"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetchApi<Sequence>(`/api/sequences/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Séquence supprimée");
      void queryClient.invalidateQueries({ queryKey: ["sequences"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sequences = data?.data ?? [];
  const templates = templatesData?.data ?? [];

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        stepOrder: prev.length,
        type: "EMAIL",
        templateId: "",
        delayDays: 0,
        delayHours: 0,
      },
    ]);
  };

  const updateStep = (index: number, patch: Partial<StepForm>) => {
    setSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
  };

  const canCreate =
    form.name &&
    steps.length > 0 &&
    steps.every(
      (step) =>
        step.type === "DELAY" ||
        (step.type === "EMAIL" && step.templateId),
    );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Séquences</CardTitle>
          <CardDescription>
            Automatisez vos envois avec des étapes email et délais.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Nouvelle séquence</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Créer une séquence</DialogTitle>
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
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Étapes</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addStep}>
                    Ajouter une étape
                  </Button>
                </div>
                {steps.map((step, index) => (
                  <div
                    key={index}
                    className="grid gap-3 rounded-lg border p-3 md:grid-cols-4"
                  >
                    <div className="grid gap-1">
                      <Label>Type</Label>
                      <Select
                        value={step.type}
                        onValueChange={(value: "EMAIL" | "DELAY") =>
                          updateStep(index, { type: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EMAIL">Email</SelectItem>
                          <SelectItem value="DELAY">Délai</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {step.type === "EMAIL" ? (
                      <div className="grid gap-1 md:col-span-3">
                        <Label>Modèle</Label>
                        <Select
                          value={step.templateId}
                          onValueChange={(value) =>
                            updateStep(index, { templateId: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choisir un modèle" />
                          </SelectTrigger>
                          <SelectContent>
                            {templates.map((template) => (
                              <SelectItem key={template.id} value={template.id}>
                                {template.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-1">
                          <Label>Jours</Label>
                          <Input
                            type="number"
                            min={0}
                            value={step.delayDays}
                            onChange={(e) =>
                              updateStep(index, {
                                delayDays: Number(e.target.value),
                              })
                            }
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label>Heures</Label>
                          <Input
                            type="number"
                            min={0}
                            max={23}
                            value={step.delayHours}
                            onChange={(e) =>
                              updateStep(index, {
                                delayHours: Number(e.target.value),
                              })
                            }
                          />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!canCreate || createMutation.isPending}
              >
                Créer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder="Rechercher une séquence..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Étapes</TableHead>
              <TableHead>Statut</TableHead>
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
            ) : sequences.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Aucune séquence trouvée
                </TableCell>
              </TableRow>
            ) : (
              sequences.map((sequence) => (
                <TableRow key={sequence.id}>
                  <TableCell>
                    <div className="font-medium">{sequence.name}</div>
                    {sequence.description && (
                      <div className="text-xs text-muted-foreground">
                        {sequence.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{sequence.steps.length} étape(s)</TableCell>
                  <TableCell>
                    <Badge variant={sequence.isActive ? "default" : "secondary"}>
                      {sequence.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(sequence.createdAt).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(sequence.id)}
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
  );
}
