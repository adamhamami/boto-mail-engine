"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const ResponsesClient = lazyNamed(
  () => import("./responses-client"),
  "ResponsesClient",
);

export default function ResponsesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Réponses</h2>
        <p className="text-sm text-muted-foreground">
          Gérez les réponses reçues et mettez à jour les contacts.
        </p>
      </div>
      <ResponsesClient />
    </div>
  );
}
