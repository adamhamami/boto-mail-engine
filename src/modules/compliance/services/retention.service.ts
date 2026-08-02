import { AuditAction } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import { auditService } from "@/modules/audit/services/audit.service";
import { anonymizeContact } from "@/modules/compliance/services/anonymize.service";

export interface RetentionRunResult {
  dryRun: boolean;
  softDeletedAnonymized: number;
  eventsPurged: number;
  auditPurged: number;
  candidates: {
    softDeleteContactIds: string[];
  };
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Job de conservation :
 * 1. Soft-deleted (sans legalHold, non anonymisés) → anonymisation
 * 2. Events hors délai → purge
 * 3. Audit hors délai (hors module compliance) → purge
 */
export async function runRetentionJob(opts: {
  dryRun: boolean;
  actorUserId?: string;
}): Promise<RetentionRunResult> {
  const env = getEnv();
  if (!env.DATA_RETENTION_ENABLED && !opts.dryRun) {
    return {
      dryRun: opts.dryRun,
      softDeletedAnonymized: 0,
      eventsPurged: 0,
      auditPurged: 0,
      candidates: { softDeleteContactIds: [] },
    };
  }

  const softCutoff = daysAgo(env.DATA_RETENTION_SOFT_DELETE_DAYS);
  const eventCutoff = daysAgo(env.DATA_RETENTION_EVENT_DAYS);
  const auditCutoff = daysAgo(env.DATA_RETENTION_AUDIT_DAYS);

  const softDeleted = await prisma.contact.findMany({
    where: {
      deletedAt: { lte: softCutoff },
      anonymizedAt: null,
      legalHold: false,
    },
    select: { id: true },
    take: 200,
  });

  let softDeletedAnonymized = 0;
  if (!opts.dryRun) {
    for (const row of softDeleted) {
      try {
        await anonymizeContact(
          row.id,
          {
            confirm: "anonymize",
            reason: `Rétention auto soft-delete > ${env.DATA_RETENTION_SOFT_DELETE_DAYS}j`,
          },
          opts.actorUserId,
        );
        softDeletedAnonymized += 1;
      } catch (error) {
        logger.warn(
          {
            contactId: row.id,
            err:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : { message: "anonymize failed" },
          },
          "Retention anonymize skipped",
        );
      }
    }
  }

  let eventsPurged = 0;
  let auditPurged = 0;

  if (!opts.dryRun) {
    const ev = await prisma.event.deleteMany({
      where: { occurredAt: { lte: eventCutoff } },
    });
    eventsPurged = ev.count;

    const au = await prisma.auditLog.deleteMany({
      where: {
        createdAt: { lte: auditCutoff },
        NOT: { module: "compliance" },
      },
    });
    auditPurged = au.count;
  } else {
    eventsPurged = await prisma.event.count({
      where: { occurredAt: { lte: eventCutoff } },
    });
    auditPurged = await prisma.auditLog.count({
      where: {
        createdAt: { lte: auditCutoff },
        NOT: { module: "compliance" },
      },
    });
  }

  const result: RetentionRunResult = {
    dryRun: opts.dryRun,
    softDeletedAnonymized: opts.dryRun
      ? softDeleted.length
      : softDeletedAnonymized,
    eventsPurged,
    auditPurged,
    candidates: {
      softDeleteContactIds: softDeleted.map((c) => c.id),
    },
  };

  await auditService.log({
    action: AuditAction.RETENTION,
    module: "compliance",
    entityType: "RetentionJob",
    entityId: undefined,
    userId: opts.actorUserId,
    newValues: result as unknown as Record<string, unknown>,
    metadata: { kind: "retention_run" },
  });

  logger.info(result, "Compliance retention job finished");
  return result;
}
