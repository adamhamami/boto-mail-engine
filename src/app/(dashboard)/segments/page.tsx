"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const SegmentsClient = lazyNamed(
  () => import("./segments-client"),
  "SegmentsClient",
);

export default function SegmentsPage() {
  return <SegmentsClient />;
}
