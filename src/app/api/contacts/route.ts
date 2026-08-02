import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { contactService } from "@/modules/contacts/services/contact.service";
import {
  createContactSchema,
  listContactsSchema,
} from "@/modules/contacts/validators/contact.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.CONTACTS_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listContactsSchema.parse(params);
    const { items, total } = await contactService.list(input);

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.CONTACTS_WRITE);
    const body: unknown = await req.json();
    const input = createContactSchema.parse(body);
    const contact = await contactService.create(input, session.user.id);

    return apiSuccess(contact, 201);
  } catch (error) {
    return apiError(error);
  }
}
