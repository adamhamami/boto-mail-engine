"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const UsersClient = lazyNamed(() => import("./users-client"), "UsersClient");

export default function UsersPage() {
  return <UsersClient />;
}
