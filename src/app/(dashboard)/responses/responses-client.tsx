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

interface ResponseEvent {
  id: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  contact: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    status: string;
    customFields: Record<string, unknown>;
    organization: { id: string; name: string } | null;
  } | null;
  campaign: { id: string; name: string } | null;
}

const statusLabels: Record<string, string> = {
  NEW: "Nouveau",
  ELIGIBLE: "Éligible",
  DISQUALIFIED: "Disqualifié",
  TO_REVIEW: "À revoir",
  QUALIFIED: "Qualifié",
  CONTACTED: "Contacté",
  RESPONDED: "Répondu",
  BOUNCED: "Rebond",
  UNSUBSCRIBED: "Désinscrit",
};

function getNotes(customFields: Record<string, unknown>): string {
  const notes = customFields.notes;
  return typeof notes === "string" ? notes : "";
}

export function ResponsesClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editItem, setEditItem] = useState<ResponseEvent | null>(null);
  const [editForm, setEditForm] = useState({ status: "RESPONDED", notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["responses", search, page],
    queryFn: () =>
      fetchApi<ResponseEvent[]>(
        `/api/responses${buildQueryString({ search, page, limit: 20 })}`,
      ),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; status: string; notes: string }) =>
      fetchApi(`/api/responses/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: payload.status,
          notes: payload.notes || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Réponse mise à jour");
      setEditItem(null);
      void queryClient.invalidateQueries({ queryKey: ["responses"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items = data?.data ?? [];
  const meta = data?.meta as
    | { totalPages?: number; hasNext?: boolean; hasPrev?: boolean }
    | undefined;

  function openEdit(item: ResponseEvent) {
    setEditItem(item);
    setEditForm({
      status: item.contact?.status ?? "RESPONDED",
      notes: item.contact ? getNotes(item.contact.customFields) : "",
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Réponses reçues</CardTitle>
          <CardDescription>
            Emails avec réponse (événements EMAIL_REPLIED).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Rechercher par email ou nom..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-sm"
          />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Campagne</TableHead>
                <TableHead>Statut</TableHead>
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
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Aucune réponse trouvée
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {new Date(item.occurredAt).toLocaleString("fr-FR")}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {[item.contact?.firstName, item.contact?.lastName]
                            .filter(Boolean)
                            .join(" ") || "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.contact?.email ?? "—"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{item.campaign?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {statusLabels[item.contact?.status ?? ""] ??
                          item.contact?.status ??
                          "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(item)}
                      >
                        Traiter
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Précédent
            </Button>
            <span className="text-sm text-muted-foreground">Page {page}</span>
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

      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Traiter la réponse</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Statut du contact</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm({ ...editForm, status: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statusLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={4}
                value={editForm.notes}
                onChange={(e) =>
                  setEditForm({ ...editForm, notes: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!editItem) return;
                updateMutation.mutate({
                  id: editItem.id,
                  status: editForm.status,
                  notes: editForm.notes,
                });
              }}
              disabled={updateMutation.isPending}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
