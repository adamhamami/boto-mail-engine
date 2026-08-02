import { SequenceStepType } from "@/generated/prisma/client";
import { ValidationError } from "@/lib/errors";
import { addCalendarDaysUtc, DEFAULT_CAMPAIGN_TIMEZONE } from "./timezone";

export const MAX_EMAIL_STEPS_V1 = 3;

/** Bornes CDC relatives au démarrage (J0). */
export const CDC_STEP_DELAY_BOUNDS: Record<
  number,
  { minDays: number; maxDays: number }
> = {
  0: { minDays: 0, maxDays: 0 },
  1: { minDays: 4, maxDays: 6 },
  2: { minDays: 10, maxDays: 14 },
};

export interface EmailStepDef {
  id: string;
  stepOrder: number;
  templateId: string;
  delayDays: number;
  delayHours: number;
  /** Index parmi les étapes EMAIL (0..2) */
  emailIndex: number;
}

export interface SequenceStepLike {
  id: string;
  stepOrder: number;
  type: SequenceStepType | string;
  templateId?: string | null;
  delayDays?: number | null;
  delayHours?: number | null;
}

/**
 * Extrait et valide les étapes EMAIL (max 3) selon le CDC.
 */
export function planEmailSteps(steps: SequenceStepLike[]): EmailStepDef[] {
  const emailSteps = [...steps]
    .filter((s) => s.type === SequenceStepType.EMAIL || s.type === "EMAIL")
    .sort((a, b) => a.stepOrder - b.stepOrder);

  if (emailSteps.length === 0) {
    throw new ValidationError("La séquence doit contenir au moins une étape EMAIL");
  }
  if (emailSteps.length > MAX_EMAIL_STEPS_V1) {
    throw new ValidationError(
      `Maximum ${MAX_EMAIL_STEPS_V1} étapes EMAIL en V1 (reçu: ${emailSteps.length})`,
    );
  }

  return emailSteps.map((step, emailIndex) => {
    if (!step.templateId) {
      throw new ValidationError(
        `templateId requis pour l'étape EMAIL #${step.stepOrder}`,
      );
    }
    const delayDays = step.delayDays ?? 0;
    const bounds = CDC_STEP_DELAY_BOUNDS[emailIndex];
    if (bounds) {
      if (delayDays < bounds.minDays || delayDays > bounds.maxDays) {
        throw new ValidationError(
          `Étape EMAIL ${emailIndex + 1}: delayDays doit être entre ${bounds.minDays} et ${bounds.maxDays} (J+${bounds.minDays}${bounds.maxDays !== bounds.minDays ? `–J+${bounds.maxDays}` : ""}), reçu ${delayDays}`,
        );
      }
    }
    return {
      id: step.id,
      stepOrder: step.stepOrder,
      templateId: step.templateId,
      delayDays,
      delayHours: step.delayHours ?? 0,
      emailIndex,
    };
  });
}

export function computeStepScheduledAt(
  campaignStartedAt: Date,
  step: Pick<EmailStepDef, "delayDays" | "delayHours">,
  timeZone: string = DEFAULT_CAMPAIGN_TIMEZONE,
): Date {
  let at = addCalendarDaysUtc(campaignStartedAt, step.delayDays, timeZone);
  if (step.delayHours > 0) {
    at = new Date(at.getTime() + step.delayHours * 60 * 60 * 1000);
  }
  return at;
}
