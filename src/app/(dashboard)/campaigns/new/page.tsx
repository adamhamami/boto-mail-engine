"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const CampaignWizardClient = lazyNamed(
  () => import("./campaign-wizard-client"),
  "CampaignWizardClient",
);

export default function NewCampaignPage() {
  return <CampaignWizardClient />;
}
