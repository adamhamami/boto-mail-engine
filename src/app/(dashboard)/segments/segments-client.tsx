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
import { buildQueryString, fetchApi } from "@/lib/api/client";

interface Segment {
  id: string;
  name: string;
  description: string | null;
  isDynamic: boolean;
  contactCount: number;
  version?: number;
  filters: Record<string, unknown>;
  createdAt: string;
}

interface PreviewResult {
  totals: {
    activeContacts: number;
    matching: number;
    eligible: number;
    excluded: number;
  };
  exclusionReasons: string[];
  items: Array<{
    id: string;
    email: string;
    status: string;
    city: string | null;
  }>;
}

const emptyFilters = {
  city: "",
  establishmentType: "",
  organizationSize: "",
  status: "",
  tags: "",
  eligibleOnly: false,
};

export function SegmentsClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    ...emptyFilters,
  });
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["segments", search],
    queryFn: () =>
      fetchApi<Segment[]>(
        `/api/segments${buildQueryString({ search, page: 1, limit: 50 })}`,
      ),
  });

  function buildFilters() {
    return {
      ...(form.city.trim() ? { city: form.city.trim() } : {}),
      ...(form.establishmentType.trim()
        ? { establishmentType: form.establishmentType.trim() }
        : {}),
      ...(form.organizationSize.trim()
        ? { organizationSize: form.organizationSize.trim() }
        : {}),
      ...(form.status ? { status: form.status } : {}),
      ...(form.tags.trim()
        ? {
            tags: form.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          }
        : {}),
      ...(form.eligibleOnly ? { eligibleOnly: true } : {}),
    };
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      fetchApi<PreviewResult>("/api/segments/preview", {
        method: "POST",
        body: JSON.stringify({ filters: buildFilters(), page: 1, limit: 10 }),
      }),
    onSuccess: (res) => setPreview(res.data),
    onError: (error: Error) => toast.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      fetchApi<Segment>("/api/segments", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          isDynamic: true,
          filters: buildFilters(),
        }),
      }),
    onSuccess: () => {
      toast.success("Segment créé");
      setOpen(false);
      setForm({ name: "", description: "", ...emptyFilters });
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ["segments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refreshMutation = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/api/segments/${id}/refresh`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Segment rafraîchi");
      void queryClient.invalidateQueries({ queryKey: ["segments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Segments</h1>
          <p className="text-muted-foreground text-sm">
            Filtres CDC — ville, type, taille, statut, tags, éligibilité
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Nouveau segment</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Créer un segment</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>Nom</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Ville</Label>
                  <Input
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Type établissement</Label>
                  <Input
                    value={form.establishmentType}
                    onChange={(e) =>
                      setForm({ ...form, establishmentType: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Taille</Label>
                  <Input
                    value={form.organizationSize}
                    onChange={(e) =>
                      setForm({ ...form, organizationSize: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Statut</Label>
                  <select
                    className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    <option value="IMPORTED">IMPORTED</option>
                    <option value="TO_REVIEW">TO_REVIEW</option>
                    <option value="ELIGIBLE">ELIGIBLE</option>
                    <option value="DISQUALIFIED">DISQUALIFIED</option>
                  </select>
                </div>
              </div>
              <div>
                <Label>Tags (séparés par virgule)</Label>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.eligibleOnly}
                  onChange={(e) =>
                    setForm({ ...form, eligibleOnly: e.target.checked })
                  }
                />
                Uniquement éligibles
              </label>
              {preview && (
                <div className="bg-muted/40 rounded-md p-3 text-sm">
                  <p>
                    Matching: {preview.totals.matching} · Éligibles:{" "}
                    {preview.totals.eligible} · Exclus:{" "}
                    {preview.totals.excluded}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {preview.exclusionReasons.join(" · ")}
                  </p>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
              >
                Aperçu volume
              </Button>
              <Button
                disabled={!form.name || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                Créer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Rechercher…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Segments</CardTitle>
          <CardDescription>
            Version incrémentée à chaque changement de filtres (snapshot
            campagne).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Chargement…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Contacts</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.data ?? []).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {s.description}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{s.contactCount}</Badge>
                    </TableCell>
                    <TableCell>v{s.version ?? 1}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => refreshMutation.mutate(s.id)}
                      >
                        Rafraîchir
                      </Button>
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
