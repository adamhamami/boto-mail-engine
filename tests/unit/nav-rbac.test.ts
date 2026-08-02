import { describe, it, expect } from "vitest";
import {
  filterNavItems,
  hasPermission,
  NAV_ITEMS,
} from "@/lib/auth/nav";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
} from "@/lib/auth/permissions";

describe("RBAC navigation", () => {
  it("définit les écrans Phase 6 attendus", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(hrefs).toContain("/dashboard");
    expect(hrefs).toContain("/contacts");
    expect(hrefs).toContain("/imports");
    expect(hrefs).toContain("/segments");
    expect(hrefs).toContain("/templates");
    expect(hrefs).toContain("/sequences");
    expect(hrefs).toContain("/campaigns");
    expect(hrefs).toContain("/responses");
    expect(hrefs).toContain("/suppression");
    expect(hrefs).toContain("/sales-tasks");
    expect(hrefs).toContain("/settings");
    expect(hrefs).toContain("/audit");
    expect(hrefs).toContain("/ops");
    expect(hrefs).toContain("/ops/smtp");
    expect(hrefs).toContain("/ops/dns");
    expect(hrefs).toContain("/ops/monitoring");
  });

  it("ADMIN voit tout", () => {
    const items = filterNavItems(ROLE_PERMISSIONS[ROLES.ADMIN]);
    expect(items.length).toBe(NAV_ITEMS.length);
  });

  it("CAMPAIGN_MANAGER : campagnes + ops, pas utilisateurs", () => {
    const perms = ROLE_PERMISSIONS[ROLES.CAMPAIGN_MANAGER];
    const items = filterNavItems(perms);
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain("/campaigns");
    expect(hrefs).toContain("/ops");
    expect(hrefs).toContain("/sales-tasks");
    expect(hrefs).not.toContain("/users");
    expect(hrefs).not.toContain("/audit");
    expect(hasPermission(perms, PERMISSIONS.CAMPAIGNS_SEND)).toBe(true);
  });

  it("SALES : réponses + tâches, pas imports ni send", () => {
    const perms = ROLE_PERMISSIONS[ROLES.SALES];
    const hrefs = filterNavItems(perms).map((i) => i.href);
    expect(hrefs).toContain("/responses");
    expect(hrefs).toContain("/sales-tasks");
    expect(hrefs).toContain("/dashboard");
    expect(hrefs).not.toContain("/imports");
    expect(hrefs).not.toContain("/ops");
    expect(hrefs).not.toContain("/settings");
    expect(hasPermission(perms, PERMISSIONS.CAMPAIGNS_SEND)).toBe(false);
  });

  it("AUDITOR : audit + ops lecture, pas tâches write UI", () => {
    const perms = ROLE_PERMISSIONS[ROLES.AUDITOR];
    const hrefs = filterNavItems(perms).map((i) => i.href);
    expect(hrefs).toContain("/audit");
    expect(hrefs).toContain("/ops");
    expect(hrefs).toContain("/dashboard");
    expect(hrefs).not.toContain("/sales-tasks");
    expect(hrefs).not.toContain("/imports");
    expect(hasPermission(perms, PERMISSIONS.SALES_TASKS_WRITE)).toBe(false);
    expect(hasPermission(perms, PERMISSIONS.OPS_READ)).toBe(true);
  });
});
