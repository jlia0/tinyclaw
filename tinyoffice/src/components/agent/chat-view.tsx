"use client";

import { useState, useEffect, useCallback } from "react";
import { usePolling, timeAgo } from "@/lib/hooks";
import {
  getAgentMessages,
  sendMessage,
  type AgentMessage,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { Markdown } from "@/components/ui/markdown";
import { Bot, ArrowUp, Square } from "lucide-react";
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
        agent: agentId,
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

  return (
    <div className="flex h-full flex-col relative">
      {/* Polling status */}
      <div className="absolute top-3 right-4 z-10 flex items-center gap-1.5">
        <div className={cn("h-1.5 w-1.5", pollError ? "bg-destructive" : "bg-primary animate-pulse-dot")} />
        <span className="text-[10px] text-muted-foreground">
          {pollError ? "Disconnected" : "Connected"}
        </span>
      </div>

      {/* Messages */}
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <Bot className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            Send a message to {agentName} to get started
          </p>
        </div>
      ) : (
        <ChatContainerRoot className="flex-1">
          <ChatContainerContent className="space-y-3 px-6 pt-4 pb-28">
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              const label = isUser ? "You" : agentName;
              const initials = label.slice(0, 2).toUpperCase();
              return (
                <div key={msg.id} className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center text-[10px] font-bold uppercase shrink-0",
                      isUser ? "bg-primary text-primary-foreground" : `${agentColor(agentId)} text-white`
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
                    <Markdown className="prose prose-sm dark:prose-invert mt-0.5 max-w-none break-words text-foreground/90">
                      {msg.content}
                    </Markdown>
                  </div>
                </div>
              );
            })}
            <ChatContainerScrollAnchor />
          </ChatContainerContent>
        </ChatContainerRoot>
      )}

      {/* Floating composer */}
      <div className="absolute bottom-4 left-6 right-6 z-10">
        <PromptInput
          value={input}
          onValueChange={setInput}
          isLoading={sending}
          onSubmit={handleSend}
          className="relative w-full shadow-lg"
        >
          <PromptInputTextarea placeholder={`Message ${agentName}...`} className="min-h-[70px]" />
          <PromptInputActions className="absolute bottom-2 right-2">
            <PromptInputAction
              tooltip={sending ? "Sending..." : "Send message"}
            >
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-full"
                disabled={!input.trim() || sending}
                onClick={handleSend}
              >
                {sending ? (
                  <Square className="size-5 fill-current" />
                ) : (
                  <ArrowUp className="size-5" />
                )}
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  );
}
