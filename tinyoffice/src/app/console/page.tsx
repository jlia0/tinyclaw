"use client";

import { useState } from "react";
import { usePolling } from "@/lib/hooks";
import {
  getAgents, getTeams, type AgentConfig, type TeamConfig,
} from "@/lib/api";
import { ChatView } from "@/components/chat-view";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export default function ConsolePage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const [target, setTarget] = useState("");

  const targetOptions: { value: string; label: string; group: string }[] = [
    { value: "", label: "Default Agent", group: "" },
  ];
  if (agents) {
    for (const [id, agent] of Object.entries(agents)) {
      targetOptions.push({ value: `@${id}`, label: agent.name, group: "agent" });
    }
  }
  if (teams) {
    for (const [id, team] of Object.entries(teams)) {
      targetOptions.push({ value: `@${id}`, label: team.name, group: "team" });
    }
  }

  const selectedLabel = target
    ? targetOptions.find((o) => o.value === target)?.label || target
    : "New Chat";

  return (
    <div className="flex h-full flex-col">
      {/* Target selector bar */}
      <div className="flex items-center gap-3 border-b px-6 py-2.5 bg-card">
        <label className="text-xs font-medium text-muted-foreground shrink-0">Send to:</label>
        <Select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="max-w-xs text-sm"
        >
          {targetOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.group === "team" ? "Team: " : opt.group === "agent" ? "Agent: " : ""}
              {opt.label}
            </option>
          ))}
        </Select>
        {target && (
          <Badge variant="outline" className="text-[10px] font-mono">{target}</Badge>
        )}
      </div>

      {/* Chat */}
      <div className="flex-1 min-h-0">
        <ChatView
          target={target}
          targetLabel={selectedLabel}
        />
      </div>
    </div>
  );
}
