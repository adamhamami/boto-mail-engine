"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const ComplianceClient = lazyNamed(
  () => import("./compliance-client"),
  "ComplianceClient",
);

export default function CompliancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Conformité</h2>
        <p className="text-sm text-muted-foreground">
          CNDP / Loi 09-08 — demandes personnes concernées, export, anonymisation
          et conservation.
        </p>
      </div>
      <ComplianceClient />
    </div>
  );
}
