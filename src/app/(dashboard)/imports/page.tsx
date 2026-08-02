"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const ImportsClient = lazyNamed(
  () => import("./imports-client"),
  "ImportsClient",
);

export default function ImportsPage() {
  return <ImportsClient />;
}
