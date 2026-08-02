"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
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

type CampaignStatus =
  | "DRAFT"
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
  totalRecipients: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  bounceCount: number;
  segment: { id: string; name: string; contactCount: number } | null;
  template: { id: string; name: string; subject: string } | null;
  sequence: { id: string; name: string } | null;
  validatedAt: string | null;
  validatedBy: { id: string; name: string | null; email: string } | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Recipient {
  id: string;
  isSent: boolean;
  sentAt: string | null;
  contact: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    organization: { id: string; name: string } | null;
  };
}

interface RecipientsResponse {
  items: Recipient[];
  stats: { total: number; sent: number; pending: number };
}

const STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Brouillon",
  PENDING_VALIDATION: "En validation",
  VALIDATED: "Validée",
  SCHEDULED: "Planifiée",
  RUNNING: "En cours",
  PAUSED: "En pause",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  FAILED: "Échouée",
};

export function CampaignDetailClient({ id }: { id: string }) {
  const { data: campaignData, isLoading: campaignLoading } = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => fetchApi<Campaign>(`/api/campaigns/${id}`),
  });

  const { data: recipientsData, isLoading: recipientsLoading } = useQuery({
    queryKey: ["campaign-recipients", id],
    queryFn: () =>
      fetchApi<RecipientsResponse>(
        `/api/campaigns/${id}/recipients${buildQueryString({ page: 1, limit: 50 })}`,
      ),
  });

  const campaign = campaignData?.data;
  const recipients = recipientsData?.data?.items ?? [];
  const stats = recipientsData?.data?.stats;

  if (campaignLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Chargement...
        </CardContent>
      </Card>
    );
  }

  if (!campaign) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Campagne introuvable
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/campaigns">
            <ArrowLeft className="mr-1 size-4" />
            Retour
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {campaign.name}
          </h1>
          {campaign.description && (
            <p className="text-sm text-muted-foreground">{campaign.description}</p>
          )}
        </div>
        <Badge className="ml-auto">{STATUS_LABELS[campaign.status]}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Destinataires</CardDescription>
            <CardTitle className="text-2xl">
              {stats?.total ?? campaign.totalRecipients}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Envoyés</CardDescription>
            <CardTitle className="text-2xl">
              {stats?.sent ?? campaign.sentCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>En attente</CardDescription>
            <CardTitle className="text-2xl">
              {stats?.pending ??
                Math.max(campaign.totalRecipients - campaign.sentCount, 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ouvertures</CardDescription>
            <CardTitle className="text-2xl">{campaign.openCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Segment</span>
              <span>{campaign.segment?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Modèle / Séquence</span>
              <span>
                {campaign.template?.name ??
                  campaign.sequence?.name ??
                  "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Validée le</span>
              <span>
                {campaign.validatedAt
                  ? new Date(campaign.validatedAt).toLocaleString("fr-FR")
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Validée par</span>
              <span>
                {campaign.validatedBy?.name ??
                  campaign.validatedBy?.email ??
                  "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Démarrée le</span>
              <span>
                {campaign.startedAt
                  ? new Date(campaign.startedAt).toLocaleString("fr-FR")
                  : "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Performance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Clics</span>
              <span>{campaign.clickCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rebonds</span>
              <span>{campaign.bounceCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Planifiée le</span>
              <span>
                {campaign.scheduledAt
                  ? new Date(campaign.scheduledAt).toLocaleString("fr-FR")
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Créée le</span>
              <span>
                {new Date(campaign.createdAt).toLocaleString("fr-FR")}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Destinataires</CardTitle>
          <CardDescription>
            Liste des contacts ciblés par cette campagne.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Envoyé le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipientsLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    Chargement...
                  </TableCell>
                </TableRow>
              ) : recipients.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    Aucun destinataire — lancez la campagne pour générer la liste.
                  </TableCell>
                </TableRow>
              ) : (
                recipients.map((recipient) => (
                  <TableRow key={recipient.id}>
                    <TableCell>
                      {[recipient.contact.firstName, recipient.contact.lastName]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </TableCell>
                    <TableCell>{recipient.contact.email}</TableCell>
                    <TableCell>
                      {recipient.contact.organization?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={recipient.isSent ? "default" : "secondary"}>
                        {recipient.isSent ? "Envoyé" : "En attente"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {recipient.sentAt
                        ? new Date(recipient.sentAt).toLocaleString("fr-FR")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
