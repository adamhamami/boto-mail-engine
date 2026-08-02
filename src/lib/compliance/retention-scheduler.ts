import { LeaderElector } from "@/lib/ha/leader-election";
import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import { runRetentionJob } from "@/modules/compliance/services/retention.service";

/**
 * Planifie le job de rétention sur le leader worker uniquement.
 */
export function startRetentionScheduler(): {
  stop: () => Promise<void>;
} {
  const env = getEnv();
  const elector = new LeaderElector(
    "compliance-retention",
    env.HA_LEADER_TTL_MS,
  );
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (!env.DATA_RETENTION_ENABLED) return;
    if (!elector.isLeader()) return;
    try {
      await runRetentionJob({ dryRun: false });
    } catch (error) {
      logger.warn(
        {
          err:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: "retention failed" },
        },
        "Compliance retention scheduler failed",
      );
    }
  };

  elector.start({
    onBecomeLeader: async () => {
      logger.info("Compliance retention leader elected");
      await tick();
    },
  });

  timer = setInterval(() => {
    void tick();
  }, env.DATA_RETENTION_INTERVAL_MS);
  timer.unref?.();

  return {
    stop: async () => {
      if (timer) clearInterval(timer);
      await elector.resign();
    },
  };
}
