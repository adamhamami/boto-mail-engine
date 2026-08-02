import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { importService } from "@/modules/imports/services/import.service";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.IMPORTS_WRITE);
    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      throw new ValidationError("Fichier requis (champ file)");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const batch = await importService.uploadFile(
      {
        filename: file.name || "import.csv",
        mimeType: file.type || "application/octet-stream",
        buffer,
      },
      session.user.id,
    );

    return apiSuccess(batch, 201);
  } catch (error) {
    return apiError(error);
  }
}
