import { type NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { exportContactSubjectData } from "@/modules/compliance/services/subject-export.service";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission(PERMISSIONS.COMPLIANCE_EXPORT);
    const { id } = await ctx.params;
    const payload = await exportContactSubjectData(id, session.user.id);
    const body = JSON.stringify(payload, null, 2);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="subject-export-${id}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
