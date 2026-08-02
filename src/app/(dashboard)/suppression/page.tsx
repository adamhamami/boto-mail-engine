"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const SuppressionClient = lazyNamed(
  () => import("./suppression-client"),
  "SuppressionClient",
);

export default function SuppressionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Liste de suppression
        </h2>
        <p className="text-sm text-muted-foreground">
          Gérez les adresses exclues des campagnes email.
        </p>
      </div>
      <SuppressionClient />
    </div>
  );
}
