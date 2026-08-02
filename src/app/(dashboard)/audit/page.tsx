"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const AuditClient = lazyNamed(() => import("./audit-client"), "AuditClient");

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Audit</h2>
        <p className="text-sm text-muted-foreground">
          Consultez et exportez le journal des actions.
        </p>
      </div>
      <AuditClient />
    </div>
  );
}
