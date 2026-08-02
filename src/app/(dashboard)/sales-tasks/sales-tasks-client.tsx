"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildQueryString, fetchApi } from "@/lib/api/client";

interface SalesTask {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  dueAt: string | null;
  contact: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  campaign: { id: string; name: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Ouverte",
  IN_PROGRESS: "En cours",
  DONE: "Terminée",
  CANCELLED: "Annulée",
};

export function SalesTasksClient() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["sales-tasks"],
    queryFn: () =>
      fetchApi<SalesTask[]>(
        `/api/sales-tasks${buildQueryString({ page: 1, limit: 50 })}`,
      ),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/api/sales-tasks/${id}/complete`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Tâche terminée");
      void queryClient.invalidateQueries({ queryKey: ["sales-tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tasks = data?.data ?? [];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Chargement des tâches…
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <p role="alert" className="text-destructive">
            {error instanceof Error ? error.message : "Erreur"}
          </p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tâches commerciales</CardTitle>
        <CardDescription>
          Suivi des réponses et demandes de démonstration (données réelles).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune tâche</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titre</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Campagne</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Priorité</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">{task.title}</TableCell>
                  <TableCell>{task.contact.email}</TableCell>
                  <TableCell>{task.campaign?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {STATUS_LABELS[task.status] ?? task.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{task.priority}</TableCell>
                  <TableCell className="text-right">
                    {task.status !== "DONE" && task.status !== "CANCELLED" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={completeMutation.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Marquer cette tâche comme terminée ?",
                            )
                          ) {
                            completeMutation.mutate(task.id);
                          }
                        }}
                      >
                        Terminer
                      </Button>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
