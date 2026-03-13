"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePolling, timeAgo } from "@/lib/hooks";
import {
  getAgentMessages,
  sendMessage,
  type AgentMessage,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Bot, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AgentChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
  sender?: string;
  message_id?: string;
}

function stripAgentPrefix(content: string, agentId: string): string {
  const spaced = `@${agentId} `;
  if (content.startsWith(spaced)) return content.slice(spaced.length);
  const newline = `@${agentId}\n`;
  if (content.startsWith(newline)) return content.slice(newline.length);
  return content;
}

function normalizeMessage(message: AgentMessage, agentId: string): AgentChatItem {
  const content = message.role === "user"
    ? stripAgentPrefix(message.content, agentId)
    : message.content;
  return {
    id: `db-${message.id}`,
    role: message.role,
    content,
    created_at: message.created_at,
    sender: message.sender,
    message_id: message.message_id,
  };
}

export function AgentChatView({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [messages, setMessages] = useState<AgentChatItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    return getAgentMessages(agentId, 200, 0);
  }, [agentId]);

  const { data: polledMessages, error: pollError } =
    usePolling<AgentMessage[]>(fetchMessages, 2000, [agentId]);

  useEffect(() => {
    if (!polledMessages) return;
    const normalized = polledMessages.map((row) => normalizeMessage(row, agentId));
    setMessages((prev) => {
      const presentIds = new Set(
        normalized.map((msg) => msg.message_id).filter(Boolean)
      );
      const seen = new Set(normalized.map((msg) => `${msg.role}:${msg.content}`));
      const combined = [...normalized];
      for (const msg of prev) {
        const key = `${msg.role}:${msg.content}`;
        const hasId = msg.message_id && presentIds.has(msg.message_id);
        if (hasId || seen.has(key)) continue;
        combined.push(msg);
      }
      combined.sort((a, b) => {
        if (a.created_at !== b.created_at) return a.created_at - b.created_at;
        return a.id.localeCompare(b.id);
      });
      return combined.length > 300 ? combined.slice(-300) : combined;
    });
  }, [polledMessages, agentId]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    const outbound = input.trim();
    const pendingId = `local-${Date.now()}`;
    const createdAt = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        id: pendingId,
        role: "user",
        content: outbound,
        created_at: createdAt,
        sender: "You",
      },
    ]);
    try {
      const result = await sendMessage({
        message: `@${agentId} ${outbound}`,
        sender: "Web",
        channel: "web",
      });

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === pendingId
            ? { ...msg, message_id: result.messageId }
            : msg
        )
      );

      setInput("");
    } catch {
      // ignore send errors for now
    } finally {
      setSending(false);
    }
  }, [input, sending, agentId]);

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
          <span className="text-sm font-semibold">{agentName}</span>
          <Badge variant="outline" className="text-xs font-mono">@{agentId}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn("h-1.5 w-1.5", pollError ? "bg-destructive" : "bg-primary animate-pulse-dot")} />
          <span className="text-[10px] text-muted-foreground">
            {pollError ? "Disconnected" : "Polling"}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              Send a message to {agentName} to get started
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              const label = isUser ? "You" : agentName;
              const initials = label.slice(0, 2).toUpperCase();
              return (
                <div key={msg.id} className="flex items-start gap-3 group">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center text-[10px] font-bold uppercase shrink-0 text-white",
                      isUser ? "bg-primary" : "bg-emerald-500"
                    )}
                  >
                    {isUser ? "You" : initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">{label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(msg.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90 mt-0.5 break-words whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={feedEndRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t px-6 py-4">
        <div className="flex gap-3 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agentName}...`}
            rows={2}
            className="flex-1 text-sm resize-none min-h-[44px]"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || sending}
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
