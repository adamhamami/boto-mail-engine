"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const DashboardClient = lazyNamed(
  () => import("./dashboard-client"),
  "DashboardClient",
);

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Tableau de bord</h2>
        <p className="text-sm text-muted-foreground">
          Vue d&apos;ensemble de votre activité de prospection email.
        </p>
      </div>
      <DashboardClient />
    </div>
  );
}
