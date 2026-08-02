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

interface SuppressionEntry {
  id: string;
  email: string;
  reason: string;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; name: string | null; email: string } | null;
}

const reasonLabels: Record<string, string> = {
  UNSUBSCRIBE: "Désinscription",
  BOUNCE_HARD: "Rebond dur",
  BOUNCE_SOFT: "Rebond doux",
  COMPLAINT: "Plainte",
  MANUAL: "Manuel",
  GDPR: "RGPD",
};

export function SuppressionClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    email: "",
    reason: "MANUAL",
    notes: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["suppression", search, reason],
    queryFn: () =>
      fetchApi<SuppressionEntry[]>(
        `/api/suppression${buildQueryString({
          search,
          reason: reason === "all" ? undefined : reason,
          page: 1,
          limit: 50,
        })}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      fetchApi<SuppressionEntry>("/api/suppression", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          reason: form.reason,
          notes: form.notes || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Email ajouté à la liste de suppression");
      setOpen(false);
      setForm({ email: "", reason: "MANUAL", notes: "" });
      void queryClient.invalidateQueries({ queryKey: ["suppression"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/api/suppression/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Entrée supprimée");
      void queryClient.invalidateQueries({ queryKey: ["suppression"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const entries = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Liste de suppression</CardTitle>
          <CardDescription>
            Emails exclus des envois futurs.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Ajouter un email</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajouter à la suppression</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Raison</Label>
                <Select
                  value={form.reason}
                  onValueChange={(v) => setForm({ ...form, reason: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(reasonLabels).map(([key, label]) => (
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
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!form.email || createMutation.isPending}
              >
                Ajouter
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <Input
            placeholder="Rechercher par email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Toutes les raisons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              {Object.entries(reasonLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Raison</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Ajouté le</TableHead>
              <TableHead>Par</TableHead>
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
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Aucune entrée
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {reasonLabels[entry.reason] ?? entry.reason}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {entry.notes ?? "—"}
                  </TableCell>
                  <TableCell>
                    {new Date(entry.createdAt).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell>
                    {entry.createdBy?.name ?? entry.createdBy?.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(entry.id)}
                    >
                      Retirer
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
