import "dotenv/config";
import { getQueue, QUEUE_NAMES } from "../src/lib/queue";

async function main() {
  const q = getQueue(QUEUE_NAMES.EMAIL_SEND);
  const delayed = await q.getJobs(["delayed"], 0, 100);
  console.log(`Promoting ${delayed.length} delayed jobs...`);
  for (const job of delayed) {
    if (job) {
      await job.promote();
      console.log(" promoted", job.id);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
