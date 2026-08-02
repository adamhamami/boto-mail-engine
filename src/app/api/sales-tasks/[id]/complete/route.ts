import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { salesTaskService } from "@/modules/sales-tasks/services/sales-task.service";
import { withRequestContext } from "@/lib/observability/http";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    return await withRequestContext(req, async () => {
      const session = await requirePermission(PERMISSIONS.SALES_TASKS_WRITE);
      const { id } = await params;
      const task = await salesTaskService.complete(id, session.user.id);
      return apiSuccess(task);
    });
  } catch (error) {
    return apiError(error);
  }
}
