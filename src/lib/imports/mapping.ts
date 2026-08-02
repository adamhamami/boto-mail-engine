import { z } from "zod";
import { normalizeEmailAddress } from "@/lib/data/integrity";

export const IMPORT_TARGET_FIELDS = [
  "email",
  "firstName",
  "lastName",
  "phone",
  "jobTitle",
  "city",
  "organizationName",
  "establishmentType",
  "organizationSize",
  "tags",
  "source",
  "consentBase",
] as const;

export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

export const columnMappingSchema = z
  .record(z.string(), z.string().nullable())
  .refine((m) => Object.values(m).includes("email"), {
    message: "Le champ email doit être mappé",
  });

export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export const importRowSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  organizationName: z.string().optional().nullable(),
  establishmentType: z.string().optional().nullable(),
  organizationSize: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  source: z.string().optional().nullable(),
  consentBase: z.string().optional().nullable(),
});

export type ImportRow = z.infer<typeof importRowSchema>;

/** Mapping header → champ cible (valeur = target field name). */
export function applyMapping(
  headers: string[],
  row: string[],
  mapping: Record<string, string | null>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i]!;
    const target = mapping[header];
    if (!target) continue;
    out[target] = row[i] ?? "";
  }
  return out;
}

export function mapRawToImportRow(
  raw: Record<string, string>,
): { ok: true; row: ImportRow } | { ok: false; message: string } {
  const tags =
    raw.tags && raw.tags.trim()
      ? raw.tags.split(/[;,|]/).map((t) => t.trim()).filter(Boolean)
      : [];

  const parsed = importRowSchema.safeParse({
    email: raw.email?.trim(),
    firstName: emptyToNull(raw.firstName),
    lastName: emptyToNull(raw.lastName),
    phone: emptyToNull(raw.phone),
    jobTitle: emptyToNull(raw.jobTitle),
    city: emptyToNull(raw.city),
    organizationName: emptyToNull(raw.organizationName),
    establishmentType: emptyToNull(raw.establishmentType),
    organizationSize: emptyToNull(raw.organizationSize),
    tags,
    source: emptyToNull(raw.source) ?? "import",
    consentBase: emptyToNull(raw.consentBase),
  });

  if (!parsed.success) {
    const emailIssue = parsed.error.issues.find((i) => i.path[0] === "email");
    return {
      ok: false,
      message: emailIssue ? "Email invalide" : "Ligne invalide",
    };
  }

  return {
    ok: true,
    row: {
      ...parsed.data,
      email: normalizeEmailAddress(parsed.data.email),
    },
  };
}

function emptyToNull(value: string | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  return value.trim();
}

export function suggestMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const aliases: Record<string, ImportTargetField> = {
    email: "email",
    courriel: "email",
    mail: "email",
    "e-mail": "email",
    prenom: "firstName",
    prénom: "firstName",
    firstname: "firstName",
    first_name: "firstName",
    nom: "lastName",
    lastname: "lastName",
    last_name: "lastName",
    telephone: "phone",
    téléphone: "phone",
    phone: "phone",
    poste: "jobTitle",
    jobtitle: "jobTitle",
    job_title: "jobTitle",
    ville: "city",
    city: "city",
    organisation: "organizationName",
    organization: "organizationName",
    etablissement: "organizationName",
    établissement: "organizationName",
    type: "establishmentType",
    type_etablissement: "establishmentType",
    industry: "establishmentType",
    taille: "organizationSize",
    size: "organizationSize",
    tags: "tags",
    source: "source",
    consentement: "consentBase",
    consent: "consentBase",
  };

  for (const header of headers) {
    const key = header.trim().toLowerCase().replace(/\s+/g, "_");
    mapping[header] = aliases[key] ?? null;
  }
  return mapping;
}
