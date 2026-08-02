import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { contactService } from "@/modules/contacts/services/contact.service";
import { qualifyContactSchema } from "@/modules/contacts/validators/contact.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.CONTACTS_QUALIFY);
    const { id } = await params;
    const body: unknown = await req.json();
    const input = qualifyContactSchema.parse(body);
    const contact = await contactService.qualify(id, input, session.user.id);

    return apiSuccess(contact, 200);
  } catch (error) {
    return apiError(error);
  }
}
