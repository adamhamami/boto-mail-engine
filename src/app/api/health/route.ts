import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getRedisConnection } from "@/lib/queue";
import {
  resolveCorrelationId,
  withCorrelationResponse,
  withRequestContext,
} from "@/lib/observability/http";
import { checkWithTimeout } from "@/lib/observability/health-timeout";

/**
 * Santé publique minimale (load balancer) — pas de secrets, pas de détails files.
 */
export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req);

  return withRequestContext(req, async () => {
    const checks = {
      database: false,
      redis: false,
      timestamp: new Date().toISOString(),
    };

    // Probes bornées : un LB ne doit jamais attendre une dépendance morte.
    const [database, redis] = await Promise.all([
      checkWithTimeout("database", async () => {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      }),
      checkWithTimeout("redis", async () => {
        const pong = await getRedisConnection().ping();
        return pong === "PONG";
      }),
    ]);

    checks.database = database;
    checks.redis = redis;

    const healthy = checks.database && checks.redis;
    const status = healthy ? 200 : 503;

    return withCorrelationResponse(
      NextResponse.json(
        {
          status: healthy ? "healthy" : "unhealthy",
          correlationId,
          checks,
        },
        { status },
      ),
      correlationId,
    );
  });
}
