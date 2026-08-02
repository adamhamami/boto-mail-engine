/**
 * Statuts DNS affichés à l'opérateur.
 * - OK : conforme pour un envoi authentifié
 * - WARNING : présent mais trop permissif / incomplet
 * - ERROR : absent, invalide ou dangereux
 */
export type DnsCheckStatus = "OK" | "WARNING" | "ERROR";

export type DnsCheckId = "spf" | "dkim" | "dmarc" | "mx" | "rdns";

export interface DnsCheckFinding {
  id: DnsCheckId;
  label: string;
  status: DnsCheckStatus;
  /** Explication courte en français pour l'UI. */
  summary: string;
  /** Détail opérationnel (enregistrements trouvés, mécanismes, etc.). */
  details: string[];
  /** Valeurs brutes utiles au diagnostic (jamais d'identifiants). */
  records: string[];
  durationMs: number;
}

export interface DnsHealthReport {
  generatedAt: string;
  lastTestAt: string;
  durationMs: number;
  cached: boolean;
  domain: string;
  fromEmail: string;
  mailProvider: string;
  smtpHostMasked: string;
  /** Agrégat : ERROR > WARNING > OK. */
  status: DnsCheckStatus;
  checks: DnsCheckFinding[];
  dkimSelectorsTried: string[];
  warnings: string[];
}
