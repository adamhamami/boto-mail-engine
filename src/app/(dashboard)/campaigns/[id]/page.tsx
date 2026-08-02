"use client";

import { use } from "react";
import { lazyNamed } from "@/components/perf/lazy-client";

const CampaignDetailClient = lazyNamed(
  () => import("./campaign-detail-client"),
  "CampaignDetailClient",
);

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function CampaignDetailPage({ params }: PageProps) {
  const { id } = use(params);
  return <CampaignDetailClient id={id} />;
}
