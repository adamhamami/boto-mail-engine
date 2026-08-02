"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const TemplatesClient = lazyNamed(
  () => import("./templates-client"),
  "TemplatesClient",
);

export default function TemplatesPage() {
  return <TemplatesClient />;
}
