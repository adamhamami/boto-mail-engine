"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const DnsHealthClient = lazyNamed(
  () => import("./dns-health-client"),
  "DnsHealthClient",
);

export default function DnsHealthPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Santé DNS</h2>
        <p className="text-sm text-muted-foreground">
          Assistant de vérification SPF, DKIM, DMARC, MX et Reverse DNS pour le
          domaine d&apos;envoi — avec statut OK / WARNING / ERROR et explication.
        </p>
      </div>
      <DnsHealthClient />
    </div>
  );
}
