"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const SettingsClient = lazyNamed(
  () => import("./settings-client"),
  "SettingsClient",
);

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Paramètres</h2>
        <p className="text-sm text-muted-foreground">
          Configurez les préférences de la plateforme et consultez SMTP.
        </p>
      </div>
      <SettingsClient />
    </div>
  );
}
