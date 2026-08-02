"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const SalesTasksClient = lazyNamed(
  () => import("./sales-tasks-client"),
  "SalesTasksClient",
);

export default function SalesTasksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Tâches commerciales
        </h2>
        <p className="text-sm text-muted-foreground">
          Qualification et suivi après réponses inbound.
        </p>
      </div>
      <SalesTasksClient />
    </div>
  );
}
