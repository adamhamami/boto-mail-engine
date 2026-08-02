import { getQueue, QUEUE_NAMES, type QueueName } from "@/lib/queue";
import { withHealthTimeout } from "@/lib/observability/health-timeout";
import type { QueueDashboard } from "./types";

const QUEUE_PROBE_MS = 3000;

const QUEUE_LABELS: Array<{ name: QueueName; label: string }> = [
  { name: QUEUE_NAMES.EMAIL_SEND, label: "email-send" },
  { name: QUEUE_NAMES.EMAIL_DLQ, label: "email-dlq" },
  { name: QUEUE_NAMES.WEBHOOK_PROCESS, label: "webhook-process" },
  { name: QUEUE_NAMES.IMPORT_PROCESS, label: "import-process" },
  { name: QUEUE_NAMES.CAMPAIGN_SCHEDULER, label: "campaign-scheduler" },
];

async function collectOne(name: QueueName, label: string): Promise<QueueDashboard> {
  try {
    return await withHealthTimeout(
      `queue-dash:${name}`,
      async () => {
        const q = getQueue(name);
        const [waiting, active, delayed, failed, completed, isPaused] =
          await Promise.all([
            q.getWaitingCount(),
            q.getActiveCount(),
            q.getDelayedCount(),
            q.getFailedCount(),
            q.getCompletedCount(),
            q.isPaused(),
          ]);
        return {
          name: label,
          waiting,
          active,
          delayed,
          failed,
          completed,
          paused: isPaused,
        };
      },
      QUEUE_PROBE_MS,
    );
  } catch {
    return {
      name: label,
      waiting: -1,
      active: -1,
      delayed: -1,
      failed: -1,
      completed: -1,
      paused: false,
    };
  }
}

export async function collectQueueDashboard(): Promise<QueueDashboard[]> {
  return Promise.all(
    QUEUE_LABELS.map(({ name, label }) => collectOne(name, label)),
  );
}
