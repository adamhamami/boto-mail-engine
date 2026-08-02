import { ForbiddenError } from "@/lib/errors";

/**
 * Séparation des devoirs (CDC / P1-2) :
 * le créateur d'une campagne ne peut pas l'approuver lui-même.
 */
export function assertApproverIsNotCreator(
  createdById: string | null | undefined,
  approverId: string,
): void {
  if (createdById && createdById === approverId) {
    throw new ForbiddenError(
      "Séparation des devoirs : le créateur de la campagne ne peut pas l'approuver",
    );
  }
}
