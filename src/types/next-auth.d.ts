import type { DefaultSession } from "next-auth";
import type { PermissionSlug } from "@/lib/auth/permissions";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      permissions: PermissionSlug[];
      roles: string[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    permissions?: PermissionSlug[];
    roles?: string[];
  }
}
