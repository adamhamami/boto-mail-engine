import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { salesTaskService } from "@/modules/sales-tasks/services/sales-task.service";
import { SalesTaskStatus } from "@/generated/prisma/client";
import { withRequestContext } from "@/lib/observability/http";

const listSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  status: z.nativeEnum(SalesTaskStatus).optional(),
});

export async function GET(req: NextRequest) {
  try {
    return await withRequestContext(req, async () => {
      await requirePermission(PERMISSIONS.SALES_TASKS_READ);
      const params = Object.fromEntries(req.nextUrl.searchParams);
      const input = listSchema.parse(params);
      const { items, total, page, limit } = await salesTaskService.list(input);
      return apiSuccess(
        items,
        200,
        getPaginationMeta(page, limit, total),
      );
    });
  } catch (error) {
    return apiError(error);
  }
}
