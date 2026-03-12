"use client";

import { use, useState, useEffect, useRef, useCallback } from "react";
import { usePolling, timeAgo } from "@/lib/hooks";
import {
  getAgents, getTeams, getChatRooms,
  sendMessage, subscribeToEvents,
  type AgentConfig, type TeamConfig, type ChatRoom, type EventData,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  Hash, Send, Bot, Users, Loader2, CheckCircle2, AlertCircle,
  ArrowRight, Radio,
} from "lucide-react";

interface FeedItem {
  id: string;
  type: "sent" | "event";
  timestamp: number;
  data: Record<string, unknown>;
}

// Events that go to the status bar instead of the main feed
const STATUS_BAR_EVENTS = new Set([
  "chain_step_start", "chain_handoff", "team_chain_start", "team_chain_end",
  "agent_routed", "processor_start", "message_enqueued",
]);

interface StatusBarEvent {
  id: string;
  type: string;
  agentId?: string;
  timestamp: number;
}

export default function RoomChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const { data: rooms } = usePolling<ChatRoom[]>(getChatRooms, 3000);
  const room = rooms?.find(r => r.id === id);

  const [message, setMessage] = useState("");
  const [sendTarget, setSendTarget] = useState("");
  const [sending, setSending] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [statusEvents, setStatusEvents] = useState<StatusBarEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef(new Set<string>());

  // Auto-scroll
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length]);

  // SSE subscription filtered by room members
  useEffect(() => {
    const unsub = subscribeToEvents(
      (event: EventData) => {
        setConnected(true);

        // Deduplicate
        const fp = `${event.type}:${event.timestamp}:${(event as Record<string, unknown>).messageId ?? ""}:${(event as Record<string, unknown>).agentId ?? ""}`;
        if (seenRef.current.has(fp)) return;
        seenRef.current.add(fp);
        if (seenRef.current.size > 500) {
          const entries = [...seenRef.current];
          seenRef.current = new Set(entries.slice(entries.length - 300));
        }

        const eventType = String((event as Record<string, unknown>).type || "");
        const agentId = (event as Record<string, unknown>).agentId
          ? String((event as Record<string, unknown>).agentId)
          : undefined;

        // Filter: if room has members, only show events from those members
        // (empty members = show all)
        if (room && room.members.length > 0 && agentId) {
          if (!room.members.includes(agentId)) return;
        }

        if (STATUS_BAR_EVENTS.has(eventType)) {
          setStatusEvents((prev) =>
            [{ id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`, type: eventType, agentId, timestamp: event.timestamp }, ...prev].slice(0, 20)
          );
          return;
        }

        setFeed((prev) => [
          ...prev,
          {
            id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
            type: "event" as const,
            timestamp: event.timestamp,
            data: event as unknown as Record<string, unknown>,
          },
        ].slice(-300));
      },
      () => setConnected(false)
    );
    return unsub;
  }, [room]);

  const handleSend = useCallback(async () => {
    if (!message.trim() || sending) return;
    const target = sendTarget || "";
    const finalMessage = target ? `@${target} ${message}` : message;
    setSending(true);
    try {
      const result = await sendMessage({ message: finalMessage, sender: "Web", channel: "web" });
      setFeed((prev) => [
        ...prev,
        {
          id: result.messageId,
          type: "sent" as const,
          timestamp: Date.now(),
          data: { message: finalMessage, messageId: result.messageId, target: target ? `@${target}` : "" },
        },
      ]);
      setMessage("");
    } catch (err) {
      setFeed((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          type: "event" as const,
          timestamp: Date.now(),
          data: { type: "error", message: (err as Error).message },
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [message, sendTarget, sending]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  // Build member options for the send target selector
  const memberOptions: { id: string; label: string; isTeam: boolean }[] = [];
  if (room) {
    const memberIds = room.members.length > 0 ? room.members : [
      ...Object.keys(agents || {}),
      ...Object.keys(teams || {}),
    ];
    for (const mid of memberIds) {
      const agent = agents?.[mid];
      const team = teams?.[mid];
      if (agent) memberOptions.push({ id: mid, label: agent.name, isTeam: false });
      else if (team) memberOptions.push({ id: mid, label: team.name, isTeam: true });
      else memberOptions.push({ id: mid, label: mid, isTeam: false });
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Room header */}
      <div className="flex items-center justify-between border-b px-6 py-3 bg-card">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{room?.name || id}</span>
          {room?.description && (
            <span className="text-xs text-muted-foreground ml-2">{room.description}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {room && (
            <div className="flex items-center gap-1.5">
              {(room.members.length === 0 ? ["All agents"] : room.members).map((m) => {
                if (m === "All agents") return (
                  <Badge key={m} variant="outline" className="text-[10px]">All agents</Badge>
                );
                const agent = agents?.[m];
                const team = teams?.[m];
                return (
                  <Badge key={m} variant="secondary" className="text-[10px] flex items-center gap-1">
                    {team ? <Users className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />}
                    {agent?.name || team?.name || m}
                  </Badge>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className={`h-1.5 w-1.5 ${connected ? "bg-primary animate-pulse-dot" : "bg-destructive"}`} />
            <span className="text-[10px] text-muted-foreground">
              {connected ? "Live" : "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {feed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Radio className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              Listening for agent messages in #{room?.name || id}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Events from room members will appear here in real time
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {feed.map((item) => (
              <FeedEntry key={item.id} item={item} agents={agents || {}} teams={teams || {}} />
            ))}
            <div ref={feedEndRef} />
          </div>
        )}
      </div>

      {/* Status bar */}
      {statusEvents.length > 0 && (
        <div className="border-t bg-muted/30 px-6 py-1.5">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
              Status
            </span>
            {statusEvents.slice(0, 6).map((evt) => (
              <div key={evt.id} className="flex items-center gap-1 shrink-0">
                <div className={`h-1.5 w-1.5 shrink-0 ${statusDotColor(evt.type)}`} />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {evt.type.replace(/_/g, " ")}
                  {evt.agentId ? ` @${evt.agentId}` : ""}
                </span>
                <span className="text-[9px] text-muted-foreground/50">{timeAgo(evt.timestamp)}</span>
                <span className="text-muted-foreground/20 mx-0.5">|</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t px-6 py-4">
        <div className="flex gap-3 items-end">
          <Select
            value={sendTarget}
            onChange={(e) => setSendTarget(e.target.value)}
            className="w-40 shrink-0 text-sm"
          >
            <option value="">Broadcast</option>
            {memberOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.isTeam ? "Team: " : ""}{m.label}
              </option>
            ))}
          </Select>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={sendTarget ? `Message @${sendTarget}...` : "Send a message..."}
            rows={2}
            className="flex-1 text-sm resize-none min-h-[44px]"
          />
          <Button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Ctrl+Enter to send
        </p>
      </div>
    </div>
  );
}

function FeedEntry({
  item,
  agents,
  teams,
}: {
  item: FeedItem;
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
}) {
  const d = item.data;

  if (item.type === "sent") {
    const target = d.target ? String(d.target) : "";
    return (
      <div className="flex items-start gap-3 border-b border-border/50 pb-2 animate-slide-up">
        <Send className="h-3.5 w-3.5 mt-1 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-primary">SENT</span>
            {target && <Badge variant="outline" className="text-[10px]">{target}</Badge>}
          </div>
          <p className="text-sm text-foreground mt-0.5 break-words whitespace-pre-wrap">
            {String(d.message ?? "")}
          </p>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {timeAgo(item.timestamp)}
        </span>
      </div>
    );
  }

  const eventType = String(d.type || "unknown");
  const agentId = d.agentId ? String(d.agentId) : undefined;
  const agentName = agentId ? (agents[agentId]?.name || agentId) : undefined;

  const icon = (() => {
    switch (eventType) {
      case "response_ready":
        return <CheckCircle2 className="h-3.5 w-3.5 mt-1 text-emerald-500 shrink-0" />;
      case "error":
        return <AlertCircle className="h-3.5 w-3.5 mt-1 text-destructive shrink-0" />;
      case "agent_routed":
        return <Bot className="h-3.5 w-3.5 mt-1 text-primary shrink-0" />;
      case "chain_handoff":
        return <ArrowRight className="h-3.5 w-3.5 mt-1 text-orange-500 shrink-0" />;
      case "team_chain_start":
      case "team_chain_end":
        return <Users className="h-3.5 w-3.5 mt-1 text-purple-500 shrink-0" />;
      default:
        return <div className="h-3.5 w-3.5 mt-1 bg-muted-foreground/40 shrink-0" />;
    }
  })();

  return (
    <div className="flex items-start gap-3 border-b border-border/50 pb-2 animate-slide-up">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            {eventType.replace(/_/g, " ")}
          </span>
          {agentName && (
            <Badge variant="secondary" className="text-[10px] flex items-center gap-1">
              <Bot className="h-2.5 w-2.5" />
              {agentName}
            </Badge>
          )}
        </div>
        {d.responseText ? (
          <p className="text-sm text-foreground mt-0.5 break-words whitespace-pre-wrap">
            {String(d.responseText)}
          </p>
        ) : d.message ? (
          <p className="text-sm text-muted-foreground mt-0.5 break-words whitespace-pre-wrap">
            {String(d.message)}
          </p>
        ) : null}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {d.channel ? <Badge variant="outline" className="text-[10px]">{String(d.channel)}</Badge> : null}
          {d.sender ? (
            <span className="text-[10px] text-muted-foreground">from {String(d.sender)}</span>
          ) : null}
        </div>
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {timeAgo(item.timestamp)}
      </span>
    </div>
  );
}

function statusDotColor(type: string): string {
  switch (type) {
    case "agent_routed": return "bg-blue-500";
    case "chain_step_start": return "bg-yellow-500";
    case "chain_handoff": return "bg-orange-500";
    case "team_chain_start": return "bg-purple-500";
    case "team_chain_end": return "bg-purple-400";
    case "message_enqueued": return "bg-cyan-500";
    case "processor_start": return "bg-primary";
    default: return "bg-muted-foreground/40";
  }
}
