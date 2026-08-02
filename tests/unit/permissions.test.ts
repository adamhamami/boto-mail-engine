import { describe, it, expect } from "vitest";
import { ROLES, ROLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";

describe("RBAC Permissions", () => {
  it("should define 4 system roles", () => {
    expect(Object.keys(ROLES)).toHaveLength(4);
  });

  it("admin should have all permissions", () => {
    const adminPerms = ROLE_PERMISSIONS[ROLES.ADMIN];
    const allPerms = Object.values(PERMISSIONS);
    expect(adminPerms).toEqual(allPerms);
  });

  it("auditor should be read/export (+ compliance write for DSR)", () => {
    const auditorPerms = ROLE_PERMISSIONS[ROLES.AUDITOR];
    // Phase 13 : compliance:write pour enregistrer/suivre les demandes CNDP
    const allowedWrite: string[] = [PERMISSIONS.COMPLIANCE_WRITE];
    for (const perm of auditorPerms) {
      const ok =
        perm.includes(":read") ||
        perm.includes(":export") ||
        allowedWrite.includes(perm);
      expect(ok).toBe(true);
    }
    expect(auditorPerms).toContain(PERMISSIONS.COMPLIANCE_EXPORT);
    expect(auditorPerms).not.toContain(PERMISSIONS.COMPLIANCE_ERASE);
    expect(auditorPerms).not.toContain(PERMISSIONS.CAMPAIGNS_SEND);
    expect(auditorPerms).not.toContain(PERMISSIONS.CONTACTS_DELETE);
  });

  it("campaign manager should be able to validate campaigns", () => {
    const managerPerms = ROLE_PERMISSIONS[ROLES.CAMPAIGN_MANAGER];
    expect(managerPerms).toContain(PERMISSIONS.CAMPAIGNS_VALIDATE);
    expect(managerPerms).toContain(PERMISSIONS.CAMPAIGNS_SEND);
  });

  it("sales should not be able to send campaigns", () => {
    const salesPerms = ROLE_PERMISSIONS[ROLES.SALES];
    expect(salesPerms).not.toContain(PERMISSIONS.CAMPAIGNS_SEND);
    expect(salesPerms).not.toContain(PERMISSIONS.CAMPAIGNS_VALIDATE);
  });
});
