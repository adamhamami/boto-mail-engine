"use client";

import dynamic from "next/dynamic";
import type { ComponentType, ReactNode } from "react";

export function PerfLoading({ label = "Chargement" }: { label?: string }) {
  return (
    <div
      className="animate-pulse space-y-3 rounded-lg border p-6"
      aria-busy="true"
      aria-label={label}
    >
      <div className="h-6 w-1/3 rounded bg-muted" />
      <div className="h-4 w-2/3 rounded bg-muted" />
      <div className="h-40 rounded bg-muted" />
    </div>
  );
}

/** Code-split d’un client component nommé (Phase 11). */
export function lazyNamed<P extends object>(
  loader: () => Promise<Record<string, ComponentType<P>>>,
  exportName: string,
  loading?: ReactNode,
) {
  return dynamic<P>(
    async () => {
      const mod = await loader();
      const Comp = mod[exportName];
      if (!Comp) {
        throw new Error(`lazyNamed: export "${exportName}" introuvable`);
      }
      return Comp;
    },
    {
      ssr: false,
      loading: () => <>{loading ?? <PerfLoading />}</>,
    },
  );
}
