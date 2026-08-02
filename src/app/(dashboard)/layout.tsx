import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { PermissionSlug } from "@/lib/auth/permissions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const permissions = (session.user.permissions ?? []) as PermissionSlug[];

  return (
    <SidebarProvider>
      <AppSidebar permissions={permissions} />
      <SidebarInset>
        <AppHeader
          user={{
            name: session.user.name,
            email: session.user.email,
          }}
        />
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl p-6 md:p-8">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
