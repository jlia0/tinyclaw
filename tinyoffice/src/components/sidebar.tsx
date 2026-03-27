"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { usePolling } from "@/lib/hooks";
import {
  getAgents, getTeams, type AgentConfig, type TeamConfig,
} from "@/lib/api";
import Image from "next/image";
import {
  Plus, Hash,
  Settings, SlidersHorizontal, ClipboardList, Building2,
  FolderKanban, Sun, Moon, SlidersVertical,
} from "lucide-react";

const AGENT_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-purple-500", "bg-orange-500",
  "bg-pink-500", "bg-cyan-500", "bg-yellow-500", "bg-red-500",
];

function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

export function Sidebar() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);

  const agentEntries = agents ? Object.entries(agents) : [];
  const teamEntries = teams ? Object.entries(teams) : [];

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <Image src="/icon.png" alt="TinyAGI" width={24} height={24} className="h-6 w-6" />
        <span className="text-base font-bold tracking-tight flex-1">TinyAGI</span>
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Dashboard + Logs */}
      <div className="px-3 pt-2 pb-1 space-y-0.5">
        {[
          { href: "/control", label: "Control Plane", icon: SlidersVertical },
          { href: "/office", label: "Office", icon: Building2 },
          { href: "/tasks", label: "Tasks", icon: ClipboardList },
          { href: "/projects", label: "Projects", icon: FolderKanban },
        ].map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors",
                active
                  ? "text-foreground bg-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </div>

      {/* Scrollable agent/team list */}
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {/* Agents */}
        <div className="pt-3">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Agents
            </span>
            <Link
              href="/agents"
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              title="Manage agents"
            >
              <SlidersHorizontal className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-0.5">
            {agentEntries.length > 0 ? (
              agentEntries.map(([id, agent]) => {
                const href = `/agents/${id}`;
                const active = pathname === href;
                return (
                  <Link
                    key={id}
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <div className={cn(
                      "flex h-6 w-6 items-center justify-center text-[10px] font-bold uppercase shrink-0 text-white",
                      agentColor(id)
                    )}>
                      {agent.name.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm leading-tight">{agent.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground leading-tight">
                        {agent.provider}/{agent.model}
                      </p>
                    </div>
                  </Link>
                );
              })
            ) : (
              <Link
                href="/agents"
                className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add agent
              </Link>
            )}
          </div>
        </div>

        {/* Chat Rooms */}
        <div className="pt-4">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Teams
            </span>
            <Link
              href="/teams"
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              title="Manage teams"
            >
              <SlidersHorizontal className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-0.5">
            {teamEntries.length > 0 ? (
              teamEntries.map(([id, team]) => {
                const href = `/chat/team/${id}`;
                const active = pathname === href;
                return (
                  <Link
                    key={id}
                    href={href}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 text-sm transition-colors group",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Hash className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      active ? "text-primary" : "text-muted-foreground"
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm leading-tight">{team.name.toLowerCase().replace(/\s+/g, "-")}</p>
                    </div>
                  </Link>
                );
              })
            ) : (
              <Link
                href="/teams"
                className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add team
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Bottom: Settings only */}
      <div className="border-t px-3 py-2">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 px-2 py-1.5 text-sm transition-colors",
            pathname.startsWith("/settings")
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </Link>
      </div>

    </aside>
  );
}
