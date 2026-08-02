"use client";

import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Tableau de bord",
  "/contacts": "Contacts",
  "/organizations": "Organisations",
  "/imports": "Imports",
  "/segments": "Segments",
  "/templates": "Modèles",
  "/sequences": "Séquences",
  "/campaigns": "Campagnes",
  "/responses": "Réponses",
  "/suppression": "Exclusions",
  "/sales-tasks": "Tâches commerciales",
  "/audit": "Audit",
  "/compliance": "Conformité",
  "/settings": "Paramètres",
  "/users": "Utilisateurs",
  "/ops": "Santé technique",
};

function getInitials(name: string | null | undefined, email: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }

  return email.slice(0, 2).toUpperCase();
}

interface AppHeaderProps {
  user: {
    name?: string | null;
    email?: string | null;
  };
}

export function AppHeader({ user }: AppHeaderProps) {
  const pathname = usePathname();
  const email = user.email ?? "";
  const title =
    PAGE_TITLES[pathname] ??
    PAGE_TITLES[
      Object.keys(PAGE_TITLES).find((path) => pathname.startsWith(`${path}/`)) ??
        ""
    ] ??
    "BotoSchool";

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <div className="flex min-w-0 flex-1 items-center">
        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      </div>
      <ThemeToggle />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative size-8 rounded-full p-0">
            <Avatar size="sm">
              <AvatarFallback className="bg-teal-600/15 text-xs font-medium text-teal-700 dark:text-teal-300">
                {getInitials(user.name, email)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium leading-none">
                {user.name ?? "Utilisateur"}
              </p>
              <p className="text-xs leading-none text-muted-foreground">{email}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="size-4" />
            Déconnexion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
