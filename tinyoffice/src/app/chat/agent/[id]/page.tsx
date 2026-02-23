"use client";

import { use } from "react";
import { usePolling } from "@/lib/hooks";
import { getAgents, type AgentConfig } from "@/lib/api";
import { ChatView } from "@/components/chat-view";
import { Badge } from "@/components/ui/badge";
import { Bot, Cpu, FolderOpen } from "lucide-react";

export default function AgentChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const agent = agents?.[id];

  return (
    <div className="flex h-full flex-col">
      {/* Agent info bar */}
      {agent && (
        <div className="flex items-center gap-3 border-b px-6 py-2.5 bg-card">
          <div className="flex h-8 w-8 items-center justify-center bg-primary/10 text-primary text-xs font-bold uppercase shrink-0">
            {agent.name.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{agent.name}</span>
              <Badge variant="outline" className="text-[10px] font-mono">@{id}</Badge>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Cpu className="h-2.5 w-2.5" />
                {agent.provider}/{agent.model}
              </span>
              {agent.working_directory && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <FolderOpen className="h-2.5 w-2.5" />
                  {agent.working_directory}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chat */}
      <div className="flex-1 min-h-0">
        <ChatView
          target={`@${id}`}
          targetLabel={agent?.name || `@${id}`}
        />
      </div>
    </div>
  );
}
