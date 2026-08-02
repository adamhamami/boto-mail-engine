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
 * Readiness — prêt à recevoir du trafic (DB + Redis).
 * Public (préfixe /api/health). Distinct de /api/health/live.
 */
export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req);

  return withRequestContext(req, async () => {
    const [database, redis] = await Promise.all([
      checkWithTimeout("ready:database", async () => {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      }),
      checkWithTimeout("ready:redis", async () => {
        return (await getRedisConnection().ping()) === "PONG";
      }),
    ]);

    const ready = database && redis;

    return withCorrelationResponse(
      NextResponse.json(
        {
          status: ready ? "ready" : "not_ready",
          correlationId,
          checks: {
            database,
            redis,
            timestamp: new Date().toISOString(),
          },
        },
        { status: ready ? 200 : 503 },
      ),
      correlationId,
    );
  });
}
