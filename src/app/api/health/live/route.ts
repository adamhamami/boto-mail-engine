import { type NextRequest, NextResponse } from "next/server";
import {
  resolveCorrelationId,
  withCorrelationResponse,
} from "@/lib/observability/http";

/**
 * Liveness — process Node vivant.
 * Ne dépend JAMAIS de Postgres/Redis (sinon un Redis down tue le pod en boucle).
 * Public (préfixe /api/health).
 */
export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req);
  return withCorrelationResponse(
    NextResponse.json(
      {
        status: "alive",
        correlationId,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    ),
    correlationId,
  );
}
