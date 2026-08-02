"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Building2,
  ClipboardList,
  FileText,
  Filter,
  Gauge,
  Globe,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessageSquareReply,
  Send,
  Settings,
  Scale,
  ShieldBan,
  Upload,
  UserCog,
  Users,
  ListTodo,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { filterNavItems } from "@/lib/auth/nav";
import type { PermissionSlug } from "@/lib/auth/permissions";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/dashboard": LayoutDashboard,
  "/contacts": Users,
  "/organizations": Building2,
  "/imports": Upload,
  "/segments": Filter,
  "/templates": FileText,
  "/sequences": Send,
  "/campaigns": Megaphone,
  "/responses": MessageSquareReply,
  "/suppression": ShieldBan,
  "/sales-tasks": ListTodo,
  "/audit": ClipboardList,
  "/compliance": Scale,
  "/settings": Settings,
  "/users": UserCog,
  "/ops": Activity,
  "/ops/smtp": Mail,
  "/ops/dns": Globe,
  "/ops/monitoring": Gauge,
};

/** Entrées ayant des sous-pages listées séparément : surlignage exact. */
const EXACT_MATCH_PATHS = new Set(["/dashboard", "/ops"]);

function isActivePath(pathname: string, href: string): boolean {
  if (EXACT_MATCH_PATHS.has(href)) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface AppSidebarProps {
  permissions: PermissionSlug[];
}

export function AppSidebar({ permissions }: AppSidebarProps) {
  const pathname = usePathname();
  const items = filterNavItems(permissions);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-teal-600 text-white">
                  <Mail className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold tracking-tight">
                    BotoSchool
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    Email Prospection
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = ICONS[item.href] ?? LayoutDashboard;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActivePath(pathname, item.href)}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <Icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          Fuseau Africa/Casablanca · RBAC actif
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
