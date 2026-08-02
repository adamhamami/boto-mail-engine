import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { getMailProvider } from "@/lib/mail";

export async function POST() {
  try {
    await requirePermission(PERMISSIONS.SETTINGS_WRITE);

    const ok = await getMailProvider().verifyConnection();
    if (!ok) {
      throw new ValidationError(
        "Échec de la connexion SMTP. Vérifiez les variables d'environnement SMTP_*.",
      );
    }

    return apiSuccess({ connected: true, message: "Connexion SMTP vérifiée avec succès" });
  } catch (error) {
    return apiError(error);
  }
}
