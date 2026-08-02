import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import {
  getPaginationMeta,
  paginationSchema,
} from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { contactService } from "@/modules/contacts/services/contact.service";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.CONTACTS_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = paginationSchema.parse(params);
    const { items, total } = await contactService.listDuplicates(
      input.page,
      input.limit,
    );

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}
