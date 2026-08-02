"use client";

import { lazyNamed } from "@/components/perf/lazy-client";

const ContactsClient = lazyNamed(
  () => import("./contacts-client"),
  "ContactsClient",
);

export default function ContactsPage() {
  return <ContactsClient />;
}
