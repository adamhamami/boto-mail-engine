import { getEnv } from "@/lib/config/env";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { timingSafeEqual } from "node:crypto";

/**
 * Auth métriques : session ops:read OU Bearer METRICS_SCRAPE_TOKEN.
 * Le token scrape n'est jamais loggé.
 */
export async function authorizeOpsMetrics(req: {
  headers: Headers;
}): Promise<"session" | "scrape-token"> {
  const token = getEnv().METRICS_SCRAPE_TOKEN?.trim();
  if (token) {
    const auth = req.headers.get("authorization")?.trim() ?? "";
    const expected = `Bearer ${token}`;
    if (auth.length === expected.length) {
      try {
        if (timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
          return "scrape-token";
        }
      } catch {
        /* length race — fall through */
      }
    }
  }

  await requirePermission(PERMISSIONS.OPS_READ);
  return "session";
}
