"use client";

import { use } from "react";
import { usePolling } from "@/lib/hooks";
import { getAgents, getTeams, type AgentConfig, type TeamConfig } from "@/lib/api";
import { ChatView } from "@/components/chat-view";
import { Badge } from "@/components/ui/badge";
import { Users, Crown, Bot } from "lucide-react";

export default function TeamChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const team = teams?.[id];

  return (
    <div className="flex h-full flex-col">
      {/* Team info bar */}
      {team && (
        <div className="border-b px-6 py-2.5 bg-card">
          <div className="flex items-center gap-2 mb-1.5">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">{team.name}</span>
            <Badge variant="outline" className="text-[10px] font-mono">@{id}</Badge>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {team.agents.map((agentId) => {
              const agent = agents?.[agentId];
              const isLeader = agentId === team.leader_agent;
              return (
                <Badge
                  key={agentId}
                  variant={isLeader ? "default" : "secondary"}
                  className="text-[10px] flex items-center gap-1"
                >
                  {isLeader ? <Crown className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />}
                  {agent?.name || agentId}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Chat */}
      <div className="flex-1 min-h-0">
        <ChatView
          target={`@${id}`}
          targetLabel={team?.name || `@${id}`}
        />
      </div>
    </div>
  );
}
