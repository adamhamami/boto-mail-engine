"use client";

import Link from "next/link";
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

type CampaignStatus =
  | "DRAFT"
  | "TESTED"
  | "PENDING_VALIDATION"
  | "VALIDATED"
  | "SCHEDULED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  isTestMode: boolean;
  totalRecipients: number;
  sentCount: number;
  segment: { id: string; name: string } | null;
  template: { id: string; name: string } | null;
  sequence: { id: string; name: string } | null;
  scheduledAt: string | null;
  startedAt: string | null;
  createdAt: string;
}

interface Segment {
  id: string;
  name: string;
}

interface Template {
  id: string;
  name: string;
}

interface Sequence {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<CampaignStatus, string> = {
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

const STATUS_VARIANTS: Record<
  CampaignStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  DRAFT: "secondary",
  TESTED: "outline",
  PENDING_VALIDATION: "outline",
  VALIDATED: "default",
  SCHEDULED: "outline",
  RUNNING: "default",
  PAUSED: "secondary",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
  FAILED: "destructive",
};

export function CampaignsClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    segmentId: "",
    sourceType: "template" as "template" | "sequence",
    templateId: "",
    sequenceId: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["campaigns", search, statusFilter],
    queryFn: () =>
      fetchApi<Campaign[]>(
        `/api/campaigns${buildQueryString({
          search,
          status: statusFilter === "all" ? undefined : statusFilter,
          page: 1,
          limit: 50,
        })}`,
      ),
  });

  const { data: segmentsData } = useQuery({
    queryKey: ["segments-for-campaigns"],
    queryFn: () =>
      fetchApi<Segment[]>(
        `/api/segments${buildQueryString({ page: 1, limit: 100 })}`,
      ),
  });

  const { data: templatesData } = useQuery({
    queryKey: ["templates-for-campaigns"],
    queryFn: () =>
      fetchApi<Template[]>(
        `/api/templates${buildQueryString({ page: 1, limit: 100 })}`,
      ),
  });

  const { data: sequencesData } = useQuery({
    queryKey: ["sequences-for-campaigns"],
    queryFn: () =>
      fetchApi<Sequence[]>(
        `/api/sequences${buildQueryString({ page: 1, limit: 100 })}`,
      ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  };

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      fetchApi<Campaign>(`/api/campaigns/${id}/${action}`, {
        method: "POST",
        body: action === "schedule" ? JSON.stringify({}) : undefined,
      }),
    onSuccess: () => {
      toast.success("Campagne mise à jour");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      fetchApi<Campaign>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          segmentId: form.segmentId,
          isTestMode: true,
          templateId:
            form.sourceType === "template" ? form.templateId : null,
          sequenceId:
            form.sourceType === "sequence" ? form.sequenceId : null,
        }),
      }),
    onSuccess: () => {
      toast.success("Campagne créée");
      setOpen(false);
      setForm({
        name: "",
        description: "",
        segmentId: "",
        sourceType: "template",
        templateId: "",
        sequenceId: "",
      });
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetchApi<Campaign>(`/api/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Campagne supprimée");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const campaigns = data?.data ?? [];
  const segments = segmentsData?.data ?? [];
  const templates = templatesData?.data ?? [];
  const sequences = sequencesData?.data ?? [];

  const canCreate =
    form.name &&
    form.segmentId &&
    ((form.sourceType === "template" && form.templateId) ||
      (form.sourceType === "sequence" && form.sequenceId));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Campagnes</CardTitle>
          <CardDescription>
            Gérez le cycle de vie complet de vos campagnes email.
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" asChild>
            <Link href="/campaigns/new">Assistant (6 étapes)</Link>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>Création rapide</Button>
            </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Créer une campagne</DialogTitle>
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
              <div className="grid gap-2">
                <Label>Segment</Label>
                <Select
                  value={form.segmentId}
                  onValueChange={(value) =>
                    setForm({ ...form, segmentId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir un segment" />
                  </SelectTrigger>
                  <SelectContent>
                    {segments.map((segment) => (
                      <SelectItem key={segment.id} value={segment.id}>
                        {segment.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Source d&apos;email</Label>
                <Select
                  value={form.sourceType}
                  onValueChange={(value: "template" | "sequence") =>
                    setForm({ ...form, sourceType: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="template">Modèle</SelectItem>
                    <SelectItem value="sequence">Séquence</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.sourceType === "template" ? (
                <div className="grid gap-2">
                  <Label>Modèle</Label>
                  <Select
                    value={form.templateId}
                    onValueChange={(value) =>
                      setForm({ ...form, templateId: value })
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
                <div className="grid gap-2">
                  <Label>Séquence</Label>
                  <Select
                    value={form.sequenceId}
                    onValueChange={(value) =>
                      setForm({ ...form, sequenceId: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir une séquence" />
                    </SelectTrigger>
                    <SelectContent>
                      {sequences.map((sequence) => (
                        <SelectItem key={sequence.id} value={sequence.id}>
                          {sequence.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder="Rechercher une campagne..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filtrer par statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Destinataires</TableHead>
              <TableHead>Envoyés</TableHead>
              <TableHead>Créé le</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Chargement...
                </TableCell>
              </TableRow>
            ) : campaigns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Aucune campagne trouvée
                </TableCell>
              </TableRow>
            ) : (
              campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell>
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="font-medium hover:underline"
                    >
                      {campaign.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {campaign.segment?.name ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={STATUS_VARIANTS[campaign.status]}>
                        {STATUS_LABELS[campaign.status]}
                      </Badge>
                      {campaign.isTestMode && (
                        <Badge variant="outline">MODE TEST</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{campaign.totalRecipients}</TableCell>
                  <TableCell>{campaign.sentCount}</TableCell>
                  <TableCell>
                    {new Date(campaign.createdAt).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    {(campaign.status === "DRAFT" ||
                      campaign.status === "TESTED") &&
                      campaign.isTestMode && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          actionMutation.mutate({
                            id: campaign.id,
                            action: "schedule",
                          })
                        }
                      >
                        Envoi test
                      </Button>
                    )}
                    {(campaign.status === "DRAFT" ||
                      campaign.status === "TESTED") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          actionMutation.mutate({
                            id: campaign.id,
                            action: "submit",
                          })
                        }
                      >
                        Soumettre
                      </Button>
                    )}
                    {campaign.status === "PENDING_VALIDATION" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            actionMutation.mutate({
                              id: campaign.id,
                              action: "validate",
                            })
                          }
                        >
                          Valider
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            actionMutation.mutate({
                              id: campaign.id,
                              action: "reject",
                            })
                          }
                        >
                          Rejeter
                        </Button>
                      </>
                    )}
                    {campaign.status === "VALIDATED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          actionMutation.mutate({
                            id: campaign.id,
                            action: "schedule",
                          })
                        }
                      >
                        Lancer
                      </Button>
                    )}
                    {campaign.status === "RUNNING" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          actionMutation.mutate({
                            id: campaign.id,
                            action: "pause",
                          })
                        }
                      >
                        Pause
                      </Button>
                    )}
                    {campaign.status === "PAUSED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          actionMutation.mutate({
                            id: campaign.id,
                            action: "resume",
                          })
                        }
                      >
                        Reprendre
                      </Button>
                    )}
                    {!["CANCELLED", "COMPLETED"].includes(campaign.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          actionMutation.mutate({
                            id: campaign.id,
                            action: "cancel",
                          })
                        }
                      >
                        Annuler
                      </Button>
                    )}
                    {campaign.status === "DRAFT" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(campaign.id)}
                      >
                        Supprimer
                      </Button>
                    )}
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
