import type { PermissionSlug } from "@/lib/auth/permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";

export interface NavItemDef {
  title: string;
  href: string;
  permission: PermissionSlug;
}

/**
 * Menus UI — filtrés par permissions session (cohérent avec requirePermission API).
 */
export const NAV_ITEMS: NavItemDef[] = [
  {
    title: "Tableau de bord",
    href: "/dashboard",
    permission: PERMISSIONS.DASHBOARD_READ,
  },
  {
    title: "Contacts",
    href: "/contacts",
    permission: PERMISSIONS.CONTACTS_READ,
  },
  {
    title: "Organisations",
    href: "/organizations",
    permission: PERMISSIONS.ORGS_READ,
  },
  {
    title: "Imports",
    href: "/imports",
    permission: PERMISSIONS.IMPORTS_READ,
  },
  {
    title: "Segments",
    href: "/segments",
    permission: PERMISSIONS.SEGMENTS_READ,
  },
  {
    title: "Modèles",
    href: "/templates",
    permission: PERMISSIONS.TEMPLATES_READ,
  },
  {
    title: "Séquences",
    href: "/sequences",
    permission: PERMISSIONS.SEQUENCES_READ,
  },
  {
    title: "Campagnes",
    href: "/campaigns",
    permission: PERMISSIONS.CAMPAIGNS_READ,
  },
  {
    title: "Réponses",
    href: "/responses",
    permission: PERMISSIONS.RESPONSES_READ,
  },
  {
    title: "Exclusions",
    href: "/suppression",
    permission: PERMISSIONS.SUPPRESSION_READ,
  },
  {
    title: "Tâches commerciales",
    href: "/sales-tasks",
    permission: PERMISSIONS.SALES_TASKS_READ,
  },
  {
    title: "Audit",
    href: "/audit",
    permission: PERMISSIONS.AUDIT_READ,
  },
  {
    title: "Conformité",
    href: "/compliance",
    permission: PERMISSIONS.COMPLIANCE_READ,
  },
  {
    title: "Paramètres",
    href: "/settings",
    permission: PERMISSIONS.SETTINGS_READ,
  },
  {
    title: "Utilisateurs",
    href: "/users",
    permission: PERMISSIONS.USERS_READ,
  },
  {
    title: "Santé technique",
    href: "/ops",
    permission: PERMISSIONS.OPS_READ,
  },
  {
    title: "Santé SMTP",
    href: "/ops/smtp",
    permission: PERMISSIONS.OPS_READ,
  },
  {
    title: "Santé DNS",
    href: "/ops/dns",
    permission: PERMISSIONS.OPS_READ,
  },
  {
    title: "Monitoring",
    href: "/ops/monitoring",
    permission: PERMISSIONS.OPS_READ,
  },
];

export function filterNavItems(
  permissions: readonly string[] | undefined | null,
): NavItemDef[] {
  const set = new Set(permissions ?? []);
  return NAV_ITEMS.filter((item) => set.has(item.permission));
}

export function hasPermission(
  permissions: readonly string[] | undefined | null,
  permission: PermissionSlug,
): boolean {
  return (permissions ?? []).includes(permission);
}
