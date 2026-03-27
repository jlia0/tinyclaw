"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/sidebar";
import {
  Building2,
  GitBranch,
  ClipboardList,
  SlidersHorizontal,
  Settings,
  Sun,
  Moon,
} from "lucide-react";

const tabs = [
  { href: "/", label: "Office", icon: Building2, exact: true },
  { href: "/org-chart", label: "Org Chart", icon: GitBranch },
  { href: "/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/control", label: "Control", icon: SlidersHorizontal },
];

const navLinks = [{ href: "/settings", label: "Settings", icon: Settings }];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  // Hide sidebar for routes served by the (office) layout group
  const officeRoutes = ["/", "/tasks", "/org-chart", "/control"];
  const hideSidebar =
    pathname === "/setup" ||
    pathname.startsWith("/office") ||
    officeRoutes.some((r) =>
      r === "/"
        ? pathname === "/"
        : pathname === r || pathname.startsWith(r + "/"),
    );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center border-b px-4 gap-1 shrink-0">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 pr-4">
          <Image
            src="/icon.png"
            alt="TinyAGI"
            width={20}
            height={20}
            className="h-5 w-5"
          />
          <span className="text-sm font-bold tracking-tight">TinyAGI</span>
        </Link>

        {/* Tabs */}
        {tabs.map(({ href, label, icon: Icon, exact }) => {
          const active = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Nav links */}
        {navLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-2.5 text-xs transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        ))}

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="ml-1 p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          title={
            resolvedTheme === "dark"
              ? "Switch to light mode"
              : "Switch to dark mode"
          }
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {!hideSidebar && <Sidebar />}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
