"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const CampaignsClient = lazyNamed(
  () => import("./campaigns-client"),
  "CampaignsClient",
);

export default function CampaignsPage() {
  return <CampaignsClient />;
}
