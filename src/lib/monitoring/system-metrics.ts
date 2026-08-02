import os from "node:os";
import type { SystemMetrics } from "./types";

/** Charge CPU approximative : loadavg(1) / cœurs × 100, plafonnée à 100. */
export function collectSystemMetrics(): SystemMetrics {
  const cores = Math.max(1, os.cpus().length);
  const [load1 = 0, load5 = 0, load15 = 0] = os.loadavg();
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const mem = process.memoryUsage();

  return {
    cpu: {
      loadPercent: Math.min(100, Math.round((load1 / cores) * 1000) / 10),
      load1,
      load5,
      load15,
      cores,
    },
    memory: {
      totalBytes,
      usedBytes,
      freeBytes,
      usedPercent: totalBytes
        ? Math.round((usedBytes / totalBytes) * 1000) / 10
        : 0,
      processRssBytes: mem.rss,
      processHeapUsedBytes: mem.heapUsed,
    },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
      nodeVersion: process.version,
    },
  };
}
