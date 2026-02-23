"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePolling } from "@/lib/hooks";
import {
  getAgents, getTeams, type AgentConfig, type TeamConfig,
} from "@/lib/api";
import {
  Zap, Plus, Users, LayoutDashboard, ScrollText,
  Settings, SlidersHorizontal, ClipboardList, Building2,
} from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);

  const agentEntries = agents ? Object.entries(agents) : [];
  const teamEntries = teams ? Object.entries(teams) : [];

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <div className="flex h-7 w-7 items-center justify-center bg-primary text-primary-foreground">
          <Zap className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-bold tracking-tight">TinyClaw</span>
      </div>

      {/* New Chat + Dashboard + Logs */}
      <div className="px-3 pt-2 pb-1 space-y-0.5">
        <Link
          href="/console"
          className={cn(
            "flex items-center gap-2 w-full px-3 py-2 text-sm font-medium border transition-colors",
            pathname === "/console"
              ? "border-primary/50 bg-primary/10 text-foreground"
              : "border-border hover:border-primary/30 hover:bg-muted text-muted-foreground"
          )}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Link>
        {[
          { href: "/", label: "Dashboard", icon: LayoutDashboard },
          { href: "/office", label: "Office", icon: Building2 },
          { href: "/tasks", label: "Tasks", icon: ClipboardList },
          { href: "/logs", label: "Logs", icon: ScrollText },
        ].map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
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
                const href = `/chat/agent/${id}`;
                const active = pathname === href;
                return (
                  <Link
                    key={id}
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 px-2 py-1.5 text-sm transition-colors group",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <div className={cn(
                      "flex h-6 w-6 items-center justify-center text-[10px] font-bold uppercase shrink-0",
                      active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
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

        {/* Teams */}
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
                      "flex items-center gap-2.5 px-2 py-1.5 text-sm transition-colors group",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <div className={cn(
                      "flex h-6 w-6 items-center justify-center shrink-0",
                      active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                    )}>
                      <Users className="h-3 w-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm leading-tight">{team.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground leading-tight">
                        {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
                      </p>
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

      {/* Status */}
      <div className="px-4 py-3 border-t">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <div className="h-1.5 w-1.5 animate-pulse-dot bg-primary" />
          Queue Processor Active
        </div>
      </div>
    </aside>
  );
}
