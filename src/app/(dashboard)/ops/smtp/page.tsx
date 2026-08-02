"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const SmtpHealthClient = lazyNamed(
  () => import("./smtp-health-client"),
  "SmtpHealthClient",
);

export default function SmtpHealthPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Santé SMTP</h2>
        <p className="text-sm text-muted-foreground">
          Connexion, délai, TLS, certificat, quotas et erreurs du connecteur
          d&apos;envoi. Le test ouvre une poignée de main SMTP — aucun email
          n&apos;est envoyé.
        </p>
      </div>
      <SmtpHealthClient />
    </div>
  );
}
