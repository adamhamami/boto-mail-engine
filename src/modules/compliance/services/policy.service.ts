import { getEnv } from "@/lib/config/env";

/**
 * Politique de conformité exposée (CNDP / Loi 09-08) — non secrète.
 * Les durées viennent de l’env (rétention configurable).
 */
export function getCompliancePolicy() {
  const env = getEnv();
  return {
    framework: ["CNDP", "Loi 09-08"],
    controller: {
      name: env.COMPLIANCE_CONTROLLER_NAME,
      email: env.COMPLIANCE_DPO_EMAIL || null,
    },
    purposes: [
      "Prospection B2B écoles / établissements (intérêt légitime ou consentement documenté)",
      "Exécution de campagnes email et suivi des interactions",
      "Gestion des exclusions, rebonds et désinscriptions",
      "Traçabilité / audit interne",
    ],
    rights: [
      "Accès",
      "Export / portabilité",
      "Rectification",
      "Effacement / anonymisation",
      "Opposition",
      "Limitation",
    ],
    retention: {
      enabled: env.DATA_RETENTION_ENABLED,
      softDeleteAnonymizeDays: env.DATA_RETENTION_SOFT_DELETE_DAYS,
      auditLogDays: env.DATA_RETENTION_AUDIT_DAYS,
      eventDays: env.DATA_RETENTION_EVENT_DAYS,
      requestDueDaysDefault: 30,
    },
    logging: {
      auditModule: "compliance",
      actions: ["ACCESS", "EXPORT", "ANONYMIZE", "ERASE", "RETENTION"],
    },
    notes: [
      "Les suppressions opérationnelles (soft delete) ne valent pas effacement CNDP.",
      "L’anonymisation conserve un stub + exclusion GDPR pour honorer l’opposition.",
      "legalHold bloque l’anonymisation automatique et manuelle.",
      "Les journaux d’audit conformité (module=compliance) sont exclus de la purge rétention.",
    ],
  };
}
