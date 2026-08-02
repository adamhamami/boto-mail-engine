"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const OpsHealthClient = lazyNamed(
  () => import("./ops-health-client"),
  "OpsHealthClient",
);

export default function OpsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Santé technique
        </h2>
        <p className="text-sm text-muted-foreground">
          DB, Redis, worker, provider, files et quotas — sans secrets.
        </p>
      </div>
      <OpsHealthClient />
    </div>
  );
}
