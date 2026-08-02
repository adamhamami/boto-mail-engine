"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const SequencesClient = lazyNamed(
  () => import("./sequences-client"),
  "SequencesClient",
);

export default function SequencesPage() {
  return <SequencesClient />;
}
