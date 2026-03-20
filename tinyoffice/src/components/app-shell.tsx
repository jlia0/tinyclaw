"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Sidebar } from "@/components/sidebar";
import { usePolling } from "@/lib/hooks";
import { checkConnection } from "@/lib/api";

const FAIL_THRESHOLD = 3; // consecutive failures before redirecting

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hideSidebar = false;
  const failCount = useRef(0);

  const { data: connected, loading } = usePolling(checkConnection, 5000);

  useEffect(() => {
    if (loading) return;
    if (connected === false) {
      failCount.current += 1;
      if (failCount.current >= FAIL_THRESHOLD && pathname !== "/settings") {
        router.replace("/settings");
      }
    } else {
      failCount.current = 0;
    }
  }, [connected, loading, pathname, router]);

  return (
    <div className="flex h-screen overflow-hidden">
      {!hideSidebar && <Sidebar />}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
