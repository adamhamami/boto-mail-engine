"use client";

import type { PermissionSlug } from "@/lib/auth/permissions";
import { hasPermission } from "@/lib/auth/nav";

interface CanProps {
  permissions: readonly string[];
  permission: PermissionSlug;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/** Masque un contrôle UI si la permission manque (le serveur reste la source de vérité). */
export function Can({
  permissions,
  permission,
  children,
  fallback = null,
}: CanProps) {
  if (!hasPermission(permissions, permission)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
