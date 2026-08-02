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

interface Organization {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  createdAt: string;
  _count: { contacts: number };
}

export function OrganizationsClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["organizations", search],
    queryFn: () =>
      fetchApi<Organization[]>(
        `/api/organizations${buildQueryString({ search, page: 1, limit: 50 })}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      fetchApi<Organization>("/api/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          domain: form.domain || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Organisation créée");
      setOpen(false);
      setForm({ name: "", domain: "" });
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetchApi<Organization>(`/api/organizations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Organisation supprimée");
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const organizations = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Organisations</CardTitle>
          <CardDescription>
            Gérez les entreprises et leurs contacts associés.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Nouvelle organisation</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer une organisation</DialogTitle>
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
                <Label htmlFor="domain">Domaine</Label>
                <Input
                  id="domain"
                  placeholder="exemple.com"
                  value={form.domain}
                  onChange={(e) =>
                    setForm({ ...form, domain: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!form.name || createMutation.isPending}
              >
                Créer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder="Rechercher par nom ou domaine..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Domaine</TableHead>
              <TableHead>Contacts</TableHead>
              <TableHead>Créée le</TableHead>
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
            ) : organizations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Aucune organisation trouvée
                </TableCell>
              </TableRow>
            ) : (
              organizations.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">{org.name}</TableCell>
                  <TableCell>{org.domain ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{org._count.contacts}</Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(org.createdAt).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(org.id)}
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
