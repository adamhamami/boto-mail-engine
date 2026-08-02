export const ROLES = {
  ADMIN: "admin",
  CAMPAIGN_MANAGER: "campaign_manager",
  SALES: "sales",
  AUDITOR: "auditor",
} as const;

export type RoleSlug = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS = {
  // Users
  USERS_READ: "users:read",
  USERS_WRITE: "users:write",
  USERS_DELETE: "users:delete",

  // Organizations
  ORGS_READ: "organizations:read",
  ORGS_WRITE: "organizations:write",
  ORGS_DELETE: "organizations:delete",

  // Contacts
  CONTACTS_READ: "contacts:read",
  CONTACTS_WRITE: "contacts:write",
  CONTACTS_DELETE: "contacts:delete",
  CONTACTS_QUALIFY: "contacts:qualify",
  /** Export CSV opérationnel (bulk) — distinct de l’export personne concernée */
  CONTACTS_EXPORT: "contacts:export",

  // Imports
  IMPORTS_READ: "imports:read",
  IMPORTS_WRITE: "imports:write",

  // Segments
  SEGMENTS_READ: "segments:read",
  SEGMENTS_WRITE: "segments:write",
  SEGMENTS_DELETE: "segments:delete",

  // Templates
  TEMPLATES_READ: "templates:read",
  TEMPLATES_WRITE: "templates:write",
  TEMPLATES_DELETE: "templates:delete",

  // Sequences
  SEQUENCES_READ: "sequences:read",
  SEQUENCES_WRITE: "sequences:write",
  SEQUENCES_DELETE: "sequences:delete",

  // Campaigns
  CAMPAIGNS_READ: "campaigns:read",
  CAMPAIGNS_WRITE: "campaigns:write",
  CAMPAIGNS_VALIDATE: "campaigns:validate",
  CAMPAIGNS_SEND: "campaigns:send",
  CAMPAIGNS_DELETE: "campaigns:delete",

  // Responses
  RESPONSES_READ: "responses:read",
  RESPONSES_WRITE: "responses:write",

  // Suppression
  SUPPRESSION_READ: "suppression:read",
  SUPPRESSION_WRITE: "suppression:write",

  // Dashboard
  DASHBOARD_READ: "dashboard:read",

  // Audit
  AUDIT_READ: "audit:read",
  AUDIT_EXPORT: "audit:export",

  // Settings
  SETTINGS_READ: "settings:read",
  SETTINGS_WRITE: "settings:write",

  // Sales tasks
  SALES_TASKS_READ: "sales_tasks:read",
  SALES_TASKS_WRITE: "sales_tasks:write",

  // Ops / santé technique
  OPS_READ: "ops:read",

  // Conformité CNDP / Loi 09-08 (Phase 13)
  COMPLIANCE_READ: "compliance:read",
  COMPLIANCE_WRITE: "compliance:write",
  COMPLIANCE_EXPORT: "compliance:export",
  COMPLIANCE_ERASE: "compliance:erase",
  COMPLIANCE_RETENTION: "compliance:retention",
} as const;

export type PermissionSlug = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<RoleSlug, PermissionSlug[]> = {
  [ROLES.ADMIN]: Object.values(PERMISSIONS),
  [ROLES.CAMPAIGN_MANAGER]: [
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_WRITE,
    PERMISSIONS.CONTACTS_QUALIFY,
    PERMISSIONS.CONTACTS_EXPORT,
    PERMISSIONS.ORGS_READ,
    PERMISSIONS.ORGS_WRITE,
    PERMISSIONS.IMPORTS_READ,
    PERMISSIONS.IMPORTS_WRITE,
    PERMISSIONS.SEGMENTS_READ,
    PERMISSIONS.SEGMENTS_WRITE,
    PERMISSIONS.TEMPLATES_READ,
    PERMISSIONS.TEMPLATES_WRITE,
    PERMISSIONS.SEQUENCES_READ,
    PERMISSIONS.SEQUENCES_WRITE,
    PERMISSIONS.CAMPAIGNS_READ,
    PERMISSIONS.CAMPAIGNS_WRITE,
    PERMISSIONS.CAMPAIGNS_VALIDATE,
    PERMISSIONS.CAMPAIGNS_SEND,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.RESPONSES_READ,
    PERMISSIONS.SUPPRESSION_READ,
    PERMISSIONS.SALES_TASKS_READ,
    PERMISSIONS.SALES_TASKS_WRITE,
    PERMISSIONS.OPS_READ,
    PERMISSIONS.COMPLIANCE_READ,
    PERMISSIONS.COMPLIANCE_WRITE,
  ],
  [ROLES.SALES]: [
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_QUALIFY,
    PERMISSIONS.ORGS_READ,
    PERMISSIONS.RESPONSES_READ,
    PERMISSIONS.RESPONSES_WRITE,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.CAMPAIGNS_READ,
    PERMISSIONS.SALES_TASKS_READ,
    PERMISSIONS.SALES_TASKS_WRITE,
  ],
  [ROLES.AUDITOR]: [
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_EXPORT,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.CAMPAIGNS_READ,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.ORGS_READ,
    PERMISSIONS.OPS_READ,
    PERMISSIONS.COMPLIANCE_READ,
    PERMISSIONS.COMPLIANCE_WRITE,
    PERMISSIONS.COMPLIANCE_EXPORT,
  ],
};
