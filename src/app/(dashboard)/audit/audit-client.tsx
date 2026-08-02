"use client";

import { useQuery } from "@tanstack/react-query";
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

interface AuditLog {
  id: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string } | null;
}

const actionLabels: Record<string, string> = {
  CREATE: "Création",
  UPDATE: "Modification",
  DELETE: "Suppression",
  LOGIN: "Connexion",
  LOGOUT: "Déconnexion",
  EXPORT: "Export",
  VALIDATE: "Validation",
  SEND: "Envoi",
  IMPORT: "Import",
  APPROVE: "Approbation",
  REJECT: "Rejet",
  ANONYMIZE: "Anonymisation",
  ERASE: "Effacement",
  RETENTION: "Rétention",
  ACCESS: "Accès conformité",
};

export function AuditClient() {
  const [module, setModule] = useState("");
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["audit", module, action, page],
    queryFn: () =>
      fetchApi<AuditLog[]>(
        `/api/audit${buildQueryString({
          page,
          limit: 20,
          module: module || undefined,
          action: action === "all" ? undefined : action,
        })}`,
      ),
  });

  const logs = data?.data ?? [];
  const meta = data?.meta as
    | { totalPages?: number; hasNext?: boolean; hasPrev?: boolean }
    | undefined;

  async function handleExport() {
    try {
      const qs = buildQueryString({
        module: module || undefined,
        action: action === "all" ? undefined : action,
      });
      const response = await fetch(`/api/audit/export${qs}`);
      if (!response.ok) {
        const json = (await response.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? "Export échoué");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Export CSV téléchargé");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export échoué");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Journal d&apos;audit</CardTitle>
          <CardDescription>
            Historique des actions sur la plateforme.
          </CardDescription>
        </div>
        <Button variant="outline" onClick={() => void handleExport()}>
          Exporter CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <div className="grid gap-2">
            <Label htmlFor="module">Module</Label>
            <Input
              id="module"
              placeholder="ex. contacts"
              value={module}
              onChange={(e) => {
                setModule(e.target.value);
                setPage(1);
              }}
              className="w-48"
            />
          </div>
          <div className="grid gap-2">
            <Label>Action</Label>
            <Select
              value={action}
              onValueChange={(v) => {
                setAction(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Toutes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                {Object.entries(actionLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Entité</TableHead>
              <TableHead>Utilisateur</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Chargement...
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Aucune entrée d&apos;audit
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    {new Date(log.createdAt).toLocaleString("fr-FR")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {actionLabels[log.action] ?? log.action}
                    </Badge>
                  </TableCell>
                  <TableCell>{log.module}</TableCell>
                  <TableCell>
                    {log.entityType}
                    {log.entityId ? ` #${log.entityId.slice(0, 8)}` : ""}
                  </TableCell>
                  <TableCell>
                    {log.user?.name ?? log.user?.email ?? "—"}
                  </TableCell>
                  <TableCell>{log.ipAddress ?? "—"}</TableCell>
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
          <span className="text-sm text-muted-foreground">
            Page {page}
            {meta?.totalPages ? ` / ${meta.totalPages}` : ""}
          </span>
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
  );
}
