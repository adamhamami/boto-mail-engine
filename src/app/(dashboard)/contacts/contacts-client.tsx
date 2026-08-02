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
import { buildQueryString, fetchApi } from "@/lib/api/client";

interface Contact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  score: number;
  isDuplicate: boolean;
  organization: { id: string; name: string } | null;
}

const statusLabels: Record<string, string> = {
  IMPORTED: "Importé",
  TO_REVIEW: "À revoir",
  ELIGIBLE: "Éligible",
  DISQUALIFIED: "Disqualifié",
  IN_SEQUENCE: "En séquence",
  RESPONDED: "Répondu",
  UNSUBSCRIBED: "Désinscrit",
  HARD_BOUNCED: "Rebond dur",
  BLOCKED: "Bloqué",
  // legacy labels
  NEW: "Nouveau",
  QUALIFIED: "Qualifié",
  CONTACTED: "Contacté",
  BOUNCED: "Rebond",
};

export function ContactsClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["contacts", search, status],
    queryFn: () =>
      fetchApi<Contact[]>(
        `/api/contacts${buildQueryString({
          search,
          status: status === "all" ? undefined : status,
          page: 1,
          limit: 50,
        })}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      fetchApi<Contact>("/api/contacts", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          firstName: form.firstName || null,
          lastName: form.lastName || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Contact créé");
      setOpen(false);
      setForm({ email: "", firstName: "", lastName: "" });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const qualifyMutation = useMutation({
    mutationFn: ({
      id,
      qualifyStatus,
      source,
      consentBase,
    }: {
      id: string;
      qualifyStatus: "ELIGIBLE" | "DISQUALIFIED" | "TO_REVIEW";
      source?: string;
      consentBase?: string;
    }) =>
      fetchApi<Contact>(`/api/contacts/${id}/qualify`, {
        method: "POST",
        body: JSON.stringify({
          status: qualifyStatus,
          ...(source ? { source } : {}),
          ...(consentBase ? { consentBase } : {}),
        }),
      }),
    onSuccess: () => {
      toast.success("Contact mis à jour");
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetchApi<Contact>(`/api/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Contact supprimé");
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const contacts = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Contacts</CardTitle>
          <CardDescription>
            Gérez vos prospects et leur qualification.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Nouveau contact</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un contact</DialogTitle>
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
                <Label htmlFor="firstName">Prénom</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lastName">Nom</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) =>
                    setForm({ ...form, lastName: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!form.email || createMutation.isPending}
              >
                Créer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder="Rechercher par email ou nom..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {Object.entries(statusLabels).map(([value, label]) => (
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
              <TableHead>Contact</TableHead>
              <TableHead>Organisation</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Score</TableHead>
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
            ) : contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Aucun contact trouvé
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <div className="font-medium">{contact.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {[contact.firstName, contact.lastName]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </div>
                    {contact.isDuplicate && (
                      <Badge variant="destructive" className="mt-1">
                        Doublon
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{contact.organization?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {statusLabels[contact.status] ?? contact.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{contact.score}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const source = window.prompt(
                          "Source du contact (obligatoire CDC)",
                          "Base écoles privées Maroc",
                        );
                        if (!source) return;
                        const consentBase = window.prompt(
                          "Base légale / autorisation (obligatoire CDC)",
                          "Prospection B2B — intérêt légitime documenté",
                        );
                        if (!consentBase) return;
                        qualifyMutation.mutate({
                          id: contact.id,
                          qualifyStatus: "ELIGIBLE",
                          source,
                          consentBase,
                        });
                      }}
                    >
                      Rendre éligible
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(contact.id)}
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
