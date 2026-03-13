"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Building2, GitBranch } from "lucide-react";

const tabs = [
  { href: "/office", label: "Office", icon: Building2 },
  { href: "/office/org-chart", label: "Org Chart", icon: GitBranch },
];

export default function OfficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b px-4 gap-1">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/office" ? pathname === "/office" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
