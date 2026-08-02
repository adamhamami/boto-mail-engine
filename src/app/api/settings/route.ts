import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { settingsService } from "@/modules/settings/services/settings.service";
import { updateSettingsSchema } from "@/modules/settings/validators/settings.validator";

export async function GET() {
  try {
    await requirePermission(PERMISSIONS.SETTINGS_READ);
    const settings = await settingsService.getPublicSettings();
    return apiSuccess(settings);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_WRITE);
    const body: unknown = await req.json();
    const input = updateSettingsSchema.parse(body);
    const settings = await settingsService.update(input, session.user.id);
    return apiSuccess(settings);
  } catch (error) {
    return apiError(error);
  }
}
