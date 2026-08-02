import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/response";
import { AppError } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { processUnsubscribe } from "@/lib/mail/unsubscribe";
import { extractClientMeta } from "@/lib/observability/http";

type RouteParams = { params: Promise<{ token: string }> };

const tokenSchema = z.string().trim().min(16).max(512);

async function assertUnsubscribeRateLimit(req: NextRequest): Promise<void> {
  const { ipAddress } = extractClientMeta(req);
  const id = ipAddress ?? "unknown";
  const rate = await consumeRateLimit("unsubscribe", id);
  if (!rate.allowed) {
    throw new AppError(
      "Trop de tentatives de désinscription. Réessayez plus tard.",
      429,
      "RATE_LIMITED",
      { retryAfterMs: rate.retryAfterMs },
    );
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await assertUnsubscribeRateLimit(req);
    const { token: raw } = await params;
    const token = tokenSchema.parse(raw);
    const result = await processUnsubscribe(token);
    return apiSuccess({
      message: result.alreadyUnsubscribed
        ? "Vous étiez déjà désinscrit."
        : "Votre désinscription a bien été prise en compte.",
      email: result.email,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    await assertUnsubscribeRateLimit(req);
    const { token: raw } = await params;
    const token = tokenSchema.parse(raw);
    const result = await processUnsubscribe(token);
    return apiSuccess({
      message: result.alreadyUnsubscribed
        ? "Vous étiez déjà désinscrit."
        : "Votre désinscription a bien été prise en compte.",
      email: result.email,
    });
  } catch (error) {
    return apiError(error);
  }
}
