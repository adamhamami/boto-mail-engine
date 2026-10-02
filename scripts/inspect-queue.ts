import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { getQueue, QUEUE_NAMES } from "../src/lib/queue";

async function main() {
  const q = getQueue(QUEUE_NAMES.EMAIL_SEND);
  const counts = {
    waiting: await q.getWaitingCount(),
    delayed: await q.getDelayedCount(),
    active: await q.getActiveCount(),
    completed: await q.getCompletedCount(),
    failed: await q.getFailedCount(),
  };
  console.log("queue counts", counts);
  const jobs = await q.getJobs(["waiting", "delayed", "active", "failed"], 0, 10);
  for (const j of jobs) {
    console.log({
      id: j?.id,
      state: await j?.getState(),
      delay: j?.opts?.delay,
      timestamp: j?.timestamp,
      processedOn: j?.processedOn,
      failedReason: j?.failedReason,
    });
  }
  const attempts = await prisma.sendAttempt.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, scheduledAt: true, idempotencyKey: true },
  });
  console.log("recent attempts", attempts);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
