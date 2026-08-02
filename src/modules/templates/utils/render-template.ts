import { getEnv } from "@/lib/config/env";

/** Variables CDC V1 §5.2 */
export const CDC_TEMPLATE_VARIABLES = [
  "prenom",
  "nom",
  "fonction",
  "etablissement",
  "ville",
  "lien_demo",
  "email_expediteur",
  "lien_desinscription",
  // aliases anglais acceptés
  "firstName",
  "lastName",
  "email",
  "organization",
] as const;

export const PREVIEW_SAMPLE_DATA: Record<string, string> = {
  prenom: "Jean",
  nom: "Dupont",
  fonction: "Directeur",
  etablissement: "École Privée Atlas",
  ville: "Casablanca",
  lien_demo: "https://botoschool.ma/demo",
  email_expediteur: "contact@botoschool.ma",
  lien_desinscription: "https://example.com/unsubscribe/preview",
  firstName: "Jean",
  lastName: "Dupont",
  email: "jean.dupont@ecole-atlas.ma",
  organization: "École Privée Atlas",
};

export function extractTemplateVariables(...contents: string[]): string[] {
  const variables = new Set<string>();
  const pattern = /\{\{(\w+)\}\}/g;

  for (const content of contents) {
    for (const match of content.matchAll(pattern)) {
      variables.add(match[1]!);
    }
  }

  return Array.from(variables).sort();
}

/** Échappement HTML pour valeurs injectées dans bodyHtml (anti-XSS R-03/R-08). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderTemplateVariables(
  content: string,
  variables: Record<string, string | null | undefined>,
  options?: { escapeHtmlValues?: boolean },
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = variables[key];
    const raw = value ?? `{{${key}}}`;
    return options?.escapeHtmlValues ? escapeHtml(raw) : raw;
  });
}

export function findMissingVariables(
  content: string,
  variables: Record<string, string | null | undefined>,
): string[] {
  const used = extractTemplateVariables(content);
  return used.filter((key) => {
    const value = variables[key];
    return value === undefined || value === null || value === "";
  });
}

export type ContactLike = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  city?: string | null;
  organization?: { name?: string | null; city?: string | null } | null;
};

export function buildContactVariables(
  contact: ContactLike,
  extras?: { unsubscribeUrl?: string; demoLink?: string },
): Record<string, string> {
  const env = getEnv();
  const etablissement = contact.organization?.name ?? "";
  const ville = contact.city ?? contact.organization?.city ?? "";

  return {
    prenom: contact.firstName ?? "",
    nom: contact.lastName ?? "",
    fonction: contact.jobTitle ?? "",
    etablissement,
    ville,
    lien_demo: extras?.demoLink ?? "https://botoschool.ma/demo",
    email_expediteur: env.SMTP_FROM_EMAIL,
    lien_desinscription: extras?.unsubscribeUrl ?? "",
    firstName: contact.firstName ?? "",
    lastName: contact.lastName ?? "",
    email: contact.email ?? "",
    organization: etablissement,
  };
}
