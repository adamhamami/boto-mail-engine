"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const OrganizationsClient = lazyNamed(
  () => import("./organizations-client"),
  "OrganizationsClient",
);

export default function OrganizationsPage() {
  return <OrganizationsClient />;
}
