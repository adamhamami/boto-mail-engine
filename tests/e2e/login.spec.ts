import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("login page is accessible", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("BotoSchool", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
