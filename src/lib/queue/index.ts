import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import {
  Queue,
  Worker,
  type Job,
  type JobsOptions,
  type Processor,
} from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAMES = {
  EMAIL_SEND: "email-send",
  EMAIL_DLQ: "email-dlq",
  IMPORT_PROCESS: "import-process",
  WEBHOOK_PROCESS: "webhook-process",
  CAMPAIGN_SCHEDULER: "campaign-scheduler",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let redisConnection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!redisConnection) {
    redisConnection = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    redisConnection.on("error", (err) => {
      logger.error({ err }, "Redis connection error");
    });
  }

  return redisConnection;
}

/** Ferme queues + connexion Redis (graceful shutdown multi-instance). */
export async function closeQueueInfrastructure(): Promise<void> {
  const closes: Promise<unknown>[] = [];
  for (const queue of queueInstances.values()) {
    closes.push(queue.close());
  }
  queueInstances.clear();
  await Promise.allSettled(closes);

  if (redisConnection) {
    try {
      await redisConnection.quit();
    } catch {
      redisConnection.disconnect();
    }
    redisConnection = null;
  }
}

const queueInstances = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  if (!queueInstances.has(name)) {
    queueInstances.set(
      name,
      new Queue(name, {
        connection: getRedisConnection(),
        defaultJobOptions: getDefaultJobOptions(name),
      }),
    );
  }

  return queueInstances.get(name)!;
}

/**
 * Backoff exponentiel + jitter (anti-thundering herd multi-worker).
 * delay_n = EMAIL_QUEUE_BACKOFF_MS * 2^(n-1) + random(0..JITTER)
 */
export function computeExponentialBackoffMs(
  attemptsMade: number,
  baseMs = env.EMAIL_QUEUE_BACKOFF_MS,
  jitterMs = env.EMAIL_QUEUE_BACKOFF_JITTER_MS,
): number {
  const exp = Math.max(0, attemptsMade - 1);
  const base = baseMs * Math.pow(2, exp);
  const jitter =
    jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
  return Math.min(base + jitter, 3_600_000);
}

function getDefaultJobOptions(name: QueueName): JobsOptions {
  // Phase 11 : rétention bornée (évite croissance Redis infinie)
  const failRetention = {
    count: env.EMAIL_QUEUE_FAIL_RETENTION_COUNT,
    age: env.EMAIL_QUEUE_FAIL_RETENTION_AGE_SEC,
  };

  if (name === QUEUE_NAMES.EMAIL_SEND) {
    return {
      attempts: env.EMAIL_QUEUE_MAX_RETRIES,
      backoff: {
        type: "custom",
      },
      removeOnComplete: {
        count: env.EMAIL_QUEUE_COMPLETE_RETENTION_COUNT,
        age: env.EMAIL_QUEUE_COMPLETE_RETENTION_AGE_SEC,
      },
      removeOnFail: failRetention,
    };
  }

  return {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { count: 500, age: 7 * 24 * 3600 },
    removeOnFail: failRetention,
  };
}

export interface EmailSendJobData {
  sendAttemptId: string;
  campaignRecipientId: string;
  contactEmail: string;
  subject: string;
  html: string;
  text?: string;
  idempotencyKey: string;
  /** Observabilité — optionnels pour rétrocompat des jobs déjà en file. */
  correlationId?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
}

export interface WebhookProcessJobData {
  webhookEventId: string;
}

export function createWorker<T>(
  name: QueueName,
  processor: (job: Job<T>) => Promise<void>,
  concurrency?: number,
): Worker<T> {
  const workerOpts: ConstructorParameters<typeof Worker<T>>[2] = {
    connection: getRedisConnection(),
    concurrency: concurrency ?? env.EMAIL_QUEUE_CONCURRENCY,
  };

  if (name === QUEUE_NAMES.EMAIL_SEND) {
    workerOpts.settings = {
      backoffStrategy: (attemptsMade: number) =>
        computeExponentialBackoffMs(attemptsMade),
    };
  }

  return new Worker(
    name,
    (async (job: Job<T>) => {
      await processor(job);
    }) as Processor<T>,
    workerOpts,
  );
}
