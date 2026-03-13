"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePolling, timeAgo } from "@/lib/hooks";
import {
  getChatMessages, postChatMessage, getAgents,
  type ChatMessage, type AgentConfig,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function ChatRoomView({
  teamId,
  teamName,
}: {
  teamId: string;
  teamName: string;
}) {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);

  // Poll for messages
  const fetchMessages = useCallback(async () => {
    const msgs = await getChatMessages(teamId, 200, 0);
    return msgs;
  }, [teamId]);

  const { data: polledMessages } = usePolling<ChatMessage[]>(fetchMessages, 2000, [teamId]);

  useEffect(() => {
    if (polledMessages) {
      setMessages(polledMessages);
      const maxId = polledMessages.reduce((max, m) => Math.max(max, m.id), 0);
      if (maxId > lastIdRef.current) {
        lastIdRef.current = maxId;
        // Auto-scroll on new messages
        setTimeout(() => {
          feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 50);
      }
    }
  }, [polledMessages]);

  // Scroll to bottom on mount
  useEffect(() => {
    feedEndRef.current?.scrollIntoView();
  }, [teamId]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await postChatMessage(teamId, input.trim());
      setInput("");
      // Optimistic: will show on next poll
    } catch {
      // Ignore
    } finally {
      setSending(false);
    }
  }, [input, teamId, sending]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Hash className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No messages yet in #{teamName.toLowerCase().replace(/\s+/g, "-")}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Agent conversations will appear here
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const agent = agents?.[msg.from_agent];
              const displayName = agent?.name || msg.from_agent;
              const initials = displayName.slice(0, 2).toUpperCase();
              const isUser = msg.from_agent === "user";

              return (
                <div key={msg.id} className="flex items-start gap-3 group">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center text-[10px] font-bold uppercase shrink-0 text-white",
                      isUser ? "bg-primary" : agentColor(msg.from_agent)
                    )}
                  >
                    {isUser ? "You" : initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">
                        {isUser ? "You" : displayName}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(msg.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90 mt-0.5 break-words whitespace-pre-wrap">
                      {msg.message}
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
            placeholder={`Message #${teamName.toLowerCase().replace(/\s+/g, "-")}...`}
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
