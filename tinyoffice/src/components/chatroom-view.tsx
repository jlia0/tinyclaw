"use client";

import { useState, useEffect, useCallback } from "react";
import { usePolling, timeAgo } from "@/lib/hooks";
import {
  getChatMessages, postChatMessage, getAgents,
  type ChatMessage, type AgentConfig,
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
import { Hash, ArrowUp, Square } from "lucide-react";
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

  const fetchMessages = useCallback(async () => {
    const msgs = await getChatMessages(teamId, 200, 0);
    return [...msgs].reverse();
  }, [teamId]);

  const { data: polledMessages } = usePolling<ChatMessage[]>(fetchMessages, 2000, [teamId]);

  useEffect(() => {
    if (polledMessages) {
      setMessages(polledMessages);
    }
  }, [polledMessages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await postChatMessage(teamId, input.trim());
      setInput("");
    } catch {
      // Ignore
    } finally {
      setSending(false);
    }
  }, [input, teamId, sending]);

  const channelName = teamName.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex h-full flex-col relative">
      {/* Messages */}
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <Hash className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            No messages yet in #{channelName}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Agent conversations will appear here
          </p>
        </div>
      ) : (
        <ChatContainerRoot className="flex-1">
          <ChatContainerContent className="space-y-3 px-6 pt-4 pb-28">
            {messages.map((msg) => {
              const agent = agents?.[msg.from_agent];
              const displayName = agent?.name || msg.from_agent;
              const initials = displayName.slice(0, 2).toUpperCase();
              const isUser = msg.from_agent === "user";

              return (
                <div key={msg.id} className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center text-[10px] font-bold uppercase shrink-0",
                      isUser ? "bg-primary text-primary-foreground" : `${agentColor(msg.from_agent)} text-white`
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
                    <Markdown className="prose prose-sm dark:prose-invert mt-0.5 max-w-none break-words text-foreground/90">
                      {msg.message}
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
          <PromptInputTextarea placeholder={`Message #${channelName}...`} className="min-h-[70px]" />
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
