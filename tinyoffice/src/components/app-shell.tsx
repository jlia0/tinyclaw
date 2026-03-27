"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Hide sidebar for routes served by the (office) layout group
  const officeRoutes = ["/", "/tasks", "/projects", "/org-chart", "/monitor"];
  const hideSidebar =
    pathname === "/setup" ||
    pathname.startsWith("/office") ||
    officeRoutes.some((r) => r === "/" ? pathname === "/" : pathname === r || pathname.startsWith(r + "/"));

  return (
    <div className="flex h-screen overflow-hidden">
      {!hideSidebar && <Sidebar />}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
