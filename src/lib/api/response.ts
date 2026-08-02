import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ApiErrorResponse, ApiSuccessResponse } from "@/lib/api/types";
import {
  getCorrelationId,
  getRequestId,
  getRequestContext,
} from "@/lib/observability/context";
import { formatTraceparent } from "@/lib/observability/tracing";

export type { ApiErrorResponse, ApiSuccessResponse } from "@/lib/api/types";

function attachObservability(
  response: NextResponse,
  correlationId?: string,
  requestId?: string,
): NextResponse {
  const corr = correlationId ?? getCorrelationId();
  const reqId = requestId ?? getRequestId();
  if (corr && corr !== "no-correlation") {
    response.headers.set("x-correlation-id", corr);
  }
  if (reqId && reqId !== "no-request") {
    response.headers.set("x-request-id", reqId);
  }
  const ctx = getRequestContext();
  if (ctx?.traceId && ctx.spanId) {
    response.headers.set(
      "traceparent",
      formatTraceparent(ctx.traceId, ctx.spanId, true),
    );
  }
  return response;
}

export function apiSuccess<T>(
  data: T,
  status = 200,
  meta?: Record<string, unknown>,
): NextResponse<ApiSuccessResponse<T>> {
  const correlationId = getCorrelationId();
  const requestId = getRequestId();
  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
    meta,
  };
  if (correlationId !== "no-correlation") {
    body.correlationId = correlationId;
  }
  if (requestId !== "no-request") {
    body.requestId = requestId;
  }
  return attachObservability(
    NextResponse.json(body, { status }),
    correlationId,
    requestId,
  ) as NextResponse<ApiSuccessResponse<T>>;
}

export function apiError(error: unknown): NextResponse<ApiErrorResponse> {
  const correlationId = getCorrelationId();
  const requestId = getRequestId();
  const withId = (
    body: ApiErrorResponse,
    status: number,
  ): NextResponse<ApiErrorResponse> => {
    if (correlationId !== "no-correlation") {
      body.correlationId = correlationId;
    }
    if (requestId !== "no-request") {
      body.requestId = requestId;
    }
    return attachObservability(
      NextResponse.json(body, { status }),
      correlationId,
      requestId,
    ) as NextResponse<ApiErrorResponse>;
  };

  if (error instanceof AppError) {
    return withId(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      error.statusCode,
    );
  }

  if (error instanceof ZodError) {
    return withId(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data",
          details: error.flatten(),
        },
      },
      400,
    );
  }

  logger.error({ err: error }, "Unhandled API error");

  return withId(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Une erreur inattendue est survenue",
      },
    },
    500,
  );
}
