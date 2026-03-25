"use client";

import { useState } from "react";
import { usePolling, useSSE, timeAgo } from "@/lib/hooks";
import {
  getAgents,
  getTeams,
  getQueueStatus,
  getProcessingMessages,
  killAgentSession,
  type AgentConfig,
  type TeamConfig,
  type QueueStatus,
  type ProcessingMessage,
  type EventData,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  Users,
  Inbox,
  Cpu,
  Send,
  MessageSquare,
  Activity,
  Clock,
  Square,
  Loader2,
} from "lucide-react";

export default function DashboardPage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const { data: queue } = usePolling<QueueStatus>(getQueueStatus, 2000);
  const { data: processing, refresh: refreshProcessing } = usePolling<ProcessingMessage[]>(getProcessingMessages, 3000);
  const { events } = useSSE(30);

  const agentCount = agents ? Object.keys(agents).length : 0;
  const teamCount = teams ? Object.keys(teams).length : 0;

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time overview of your TinyAGI system
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={<Bot className="h-4 w-4" />}
          label="Agents"
          value={agentCount}
          sub={agentCount === 1 ? "agent configured" : "agents configured"}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Teams"
          value={teamCount}
          sub={teamCount === 1 ? "team active" : "teams active"}
        />
        <StatCard
          icon={<Inbox className="h-4 w-4" />}
          label="Incoming"
          value={queue?.incoming ?? 0}
          sub="messages waiting"
          accent={queue != null && queue.incoming > 0}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Queued"
          value={queue?.queued ?? 0}
          sub="waiting for turn"
          accent={queue != null && queue.queued > 0}
        />
        <StatCard
          icon={<Cpu className="h-4 w-4" />}
          label="Processing"
          value={queue?.processing ?? 0}
          sub="in progress"
          accent={queue != null && queue.processing > 0}
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={<Send className="h-4 w-4" />}
          label="Outgoing"
          value={queue?.outgoing ?? 0}
          sub="responses ready"
        />
        <StatCard
          icon={<MessageSquare className="h-4 w-4" />}
          label="Active Conversations"
          value={queue?.activeConversations ?? 0}
          sub="team conversations"
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Recent Events"
          value={events.length}
          sub="events tracked"
        />
      </div>

      {/* Agent Sessions */}
      {processing && processing.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              Agent Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {processing.map((msg) => (
                <AgentSessionRow
                  key={msg.id}
                  msg={msg}
                  onKill={async () => {
                    await killAgentSession(msg.id);
                    refreshProcessing();
                  }}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent + Team Overview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Agents */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            {agents && Object.keys(agents).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(agents).map(([id, agent]) => (
                  <div
                    key={id}
                    className="flex items-center justify-between border-b border-border/50 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center bg-secondary text-xs font-bold uppercase">
                        {agent.name.slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{agent.name}</p>
                        <p className="text-xs text-muted-foreground">@{id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{agent.provider}</Badge>
                      <Badge variant="outline">{agent.model}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No agents configured</p>
            )}
          </CardContent>
        </Card>

        {/* Teams */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Teams
            </CardTitle>
          </CardHeader>
          <CardContent>
            {teams && Object.keys(teams).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(teams).map(([id, team]) => (
                  <div
                    key={id}
                    className="flex items-center justify-between border-b border-border/50 pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{team.name}</p>
                      <p className="text-xs text-muted-foreground">@{id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
                      </Badge>
                      <Badge variant="secondary">lead: @{team.leader_agent}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No teams configured</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Event Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Live Event Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {events.map((event, i) => (
                <div
                  key={`${event.timestamp}-${i}`}
                  className="flex items-start gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0 animate-slide-up"
                >
                  <EventDot type={event.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {formatEventType(event.type)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {formatEventDetail(event)}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {timeAgo(event.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No events yet. Send a message to get started.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function AgentSessionRow({ msg, onKill }: { msg: ProcessingMessage; onKill: () => Promise<void> }) {
  const [killing, setKilling] = useState(false);
  const isStale = msg.status === "processing" && !msg.processAlive;

  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-3 last:border-0 last:pb-0">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-secondary text-xs font-bold uppercase">
          {msg.agent.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">@{msg.agent}</p>
            {isStale ? (
              <Badge variant="destructive" className="text-xs">stale</Badge>
            ) : msg.status === "processing" ? (
              <Badge variant="default" className="bg-green-600 text-xs">processing</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">queued</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{msg.message}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-4">
        <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(msg.duration)}</span>
        <button
          onClick={async () => {
            setKilling(true);
            try { await onKill(); } finally { setKilling(false); }
          }}
          disabled={killing}
          className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
          title="Kill agent session"
        >
          {killing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
        </div>
        <div className="mt-3">
          <span className={`text-3xl font-bold tabular-nums ${accent ? "text-primary" : ""}`}>
            {value}
          </span>
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EventDot({ type }: { type: string }) {
  const colors: Record<string, string> = {
    message_received: "bg-blue-500",
    agent_routed: "bg-primary",
    chain_step_start: "bg-yellow-500",
    chain_step_done: "bg-green-500",
    response_ready: "bg-emerald-500",
    team_chain_start: "bg-purple-500",
    team_chain_end: "bg-purple-400",
    chain_handoff: "bg-orange-500",
    message_enqueued: "bg-cyan-500",
    processor_start: "bg-primary",
  };
  return (
    <div className={`mt-1.5 h-2 w-2 shrink-0 ${colors[type] || "bg-muted-foreground"}`} />
  );
}

function formatEventType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatEventDetail(event: EventData): string {
  const parts: string[] = [];
  if (event.agentId) parts.push(`@${event.agentId}`);
  if (event.agentName) parts.push(`(${event.agentName})`);
  if (event.channel) parts.push(`[${event.channel}]`);
  if (event.sender) parts.push(`from ${event.sender}`);
  if (event.teamId) parts.push(`team:${event.teamId}`);
  if (event.message) parts.push(String(event.message).substring(0, 60));
  if (event.responseLength) parts.push(`${event.responseLength} chars`);
  return parts.join(" ") || event.type;
}
