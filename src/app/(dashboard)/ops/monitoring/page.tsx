"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const MonitoringClient = lazyNamed(
  () => import("./monitoring-client"),
  "MonitoringClient",
);

export default function MonitoringPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Monitoring</h2>
        <p className="text-sm text-muted-foreground">
          Health, métriques, readiness/liveness, dashboards BullMQ / Redis /
          SMTP / Worker et alertes automatiques.
        </p>
      </div>
      <MonitoringClient />
    </div>
  );
}
