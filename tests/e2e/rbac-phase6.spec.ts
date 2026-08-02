import { test, expect } from "@playwright/test";

/**
 * Phase 6 — protection des écrans / API par rôle.
 * La matrice menus par rôle est couverte en unitaire (`nav-rbac.test.ts`).
 */
test.describe("Pages dashboard protégées", () => {
  for (const path of [
    "/dashboard",
    "/campaigns/new",
    "/sales-tasks",
    "/ops",
    "/contacts",
    "/segments",
    "/templates",
    "/sequences",
    "/responses",
    "/suppression",
    "/audit",
    "/settings",
  ]) {
    test(`${path} redirige vers login si anonyme`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe("API ops / santé / tâches", () => {
  test("GET /api/ops/health sans auth → 401/403", async ({ request }) => {
    const res = await request.get("/api/ops/health");
    expect([401, 403]).toContain(res.status());
  });

  test("GET /api/sales-tasks sans auth → 401/403", async ({ request }) => {
    const res = await request.get("/api/sales-tasks");
    expect([401, 403]).toContain(res.status());
  });

  test("GET /api/dashboard/stats sans auth → 401/403", async ({ request }) => {
    const res = await request.get("/api/dashboard/stats");
    expect([401, 403]).toContain(res.status());
  });

  test("GET /api/health public sans secrets", async ({ request }) => {
    const res = await request.get("/api/health");
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body.checks).toBeTruthy();
    expect(body.checks.database).toBeDefined();
    const raw = JSON.stringify(body).toLowerCase();
    expect(raw).not.toContain("smtp_password");
    expect(raw).not.toContain("auth_secret");
  });
});
