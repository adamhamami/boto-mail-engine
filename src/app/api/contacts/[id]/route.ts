import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { contactService } from "@/modules/contacts/services/contact.service";
import { updateContactSchema } from "@/modules/contacts/validators/contact.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.CONTACTS_READ);
    const { id } = await params;
    const contact = await contactService.getById(id);

    return apiSuccess(contact, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.CONTACTS_WRITE);
    const { id } = await params;
    const body: unknown = await req.json();
    const input = updateContactSchema.parse(body);
    const contact = await contactService.update(id, input, session.user.id);

    return apiSuccess(contact, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.CONTACTS_DELETE);
    const { id } = await params;
    const contact = await contactService.delete(id, session.user.id);

    return apiSuccess(contact, 200);
  } catch (error) {
    return apiError(error);
  }
}
