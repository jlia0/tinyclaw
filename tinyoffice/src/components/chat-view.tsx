"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { timeAgo } from "@/lib/hooks";
import {
  sendMessage,
  subscribeToEvents,
  type EventData,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Bot,
  Users,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Radio,
} from "lucide-react";

interface FeedItem {
  id: string;
  type: "sent" | "event";
  timestamp: number;
  data: Record<string, unknown>;
}

// Chain mechanic events go to status bar, not the main feed
const STATUS_BAR_EVENTS = new Set([
  "chain_step_start",
  "chain_handoff",
  "team_chain_start",
  "team_chain_end",
  "agent_routed",
  "processor_start",
  "message_enqueued",
]);

interface StatusBarEvent {
  id: string;
  type: string;
  agentId?: string;
  timestamp: number;
}

export function ChatView({
  target,
  targetLabel,
}: {
  /** The @prefix target, e.g. "@coder" or "@backend-team". Empty = no target. */
  target: string;
  /** Display label, e.g. "Coder" or "Backend Team" */
  targetLabel: string;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [statusEvents, setStatusEvents] = useState<StatusBarEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef(new Set<string>());

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length]);

  useEffect(() => {
    const unsub = subscribeToEvents(
      (event: EventData) => {
        setConnected(true);

        // Deduplicate by fingerprint (type + timestamp + key data)
        const fp = `${event.type}:${event.timestamp}:${(event as Record<string, unknown>).messageId ?? ""}:${(event as Record<string, unknown>).agentId ?? ""}`;
        if (seenRef.current.has(fp)) return;
        seenRef.current.add(fp);
        // Keep the set from growing unbounded
        if (seenRef.current.size > 500) {
          const entries = [...seenRef.current];
          seenRef.current = new Set(entries.slice(entries.length - 300));
        }

        const eventType = String((event as Record<string, unknown>).type || "");

        // Route chain mechanic events to the status bar
        if (STATUS_BAR_EVENTS.has(eventType)) {
          setStatusEvents((prev) =>
            [
              {
                id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
                type: eventType,
                agentId: (event as Record<string, unknown>).agentId
                  ? String((event as Record<string, unknown>).agentId)
                  : undefined,
                timestamp: event.timestamp,
              },
              ...prev,
            ].slice(0, 20)
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
        ].slice(-200));
      },
      () => setConnected(false)
    );
    return unsub;
  }, []);

  const handleSend = useCallback(async () => {
    if (!message.trim() || sending) return;

    const finalMessage = target ? `${target} ${message}` : message;
    setSending(true);

    try {
      const result = await sendMessage({
        message: finalMessage,
        sender: "Web",
        channel: "web",
      });

      setFeed((prev) => [
        ...prev,
        {
          id: result.messageId,
          type: "sent" as const,
          timestamp: Date.now(),
          data: { message: finalMessage, messageId: result.messageId, target },
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
  }, [message, target, sending]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{targetLabel}</span>
          {target && (
            <Badge variant="outline" className="text-xs font-mono">{target}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className={`h-1.5 w-1.5 ${connected ? "bg-primary animate-pulse-dot" : "bg-destructive"}`} />
          <span className="text-[10px] text-muted-foreground">
            {connected ? "Live" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Feed — messages flow top to bottom, auto-scroll to newest */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {feed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Radio className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {target ? `Send a message to ${targetLabel}` : "Send a message to get started"}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Events will appear here in real time
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {feed.map((item) => (
              <FeedEntry key={item.id} item={item} />
            ))}
            <div ref={feedEndRef} />
          </div>
        )}
      </div>

      {/* Status bar for chain events */}
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
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={target ? `Message ${targetLabel}...` : "Type a message..."}
            rows={2}
            className="flex-1 text-sm resize-none min-h-[44px]"
          />
          <Button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Ctrl+Enter to send
        </p>
      </div>
    </div>
  );
}

function FeedEntry({ item }: { item: FeedItem }) {
  const d = item.data;

  if (item.type === "sent") {
    const target = d.target ? String(d.target) : "";
    return (
      <div className="flex items-start gap-3 border-b border-border/50 pb-2 animate-slide-up">
        <Send className="h-3.5 w-3.5 mt-1 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-primary">SENT</span>
            {target && (
              <Badge variant="outline" className="text-[10px]">
                {target}
              </Badge>
            )}
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
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          {eventType.replace(/_/g, " ")}
        </span>
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
          {d.agentId ? <Badge variant="secondary" className="text-[10px]">@{String(d.agentId)}</Badge> : null}
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
