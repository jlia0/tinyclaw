"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { Markdown } from "@/components/ui/markdown";
import { PIXEL_SCENE_LAYOUT } from "@/components/pixel-office-scene";
import { sendMessage, type AgentConfig, type AgentMessage } from "@/lib/api";
import { timeAgo } from "@/lib/hooks";
import type { ConversationEntry, LiveBubble } from "./types";

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

type ConversationPanelProps = {
  agents: Record<string, AgentConfig> | null;
  agentEntries: [string, AgentConfig][];
  agentHistories: Record<string, AgentMessage[]> | null;
  bubbles: LiveBubble[];
};

export function ConversationPanel({
  agents,
  agentEntries,
  agentHistories,
  bubbles,
}: ConversationPanelProps) {
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationFilter, setConversationFilter] = useState<string>("all");

  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const conversationStickToBottomRef = useRef(true);

  const setConversationFilterAndStick = useCallback((nextFilter: string) => {
    conversationStickToBottomRef.current = true;
    setConversationFilter(nextFilter);
  }, []);

  const handleSend = useCallback(async () => {
    if (!chatInput.trim() || sending) return;
    setSending(true);
    try {
      const message =
        conversationFilter !== "all" && !chatInput.trim().startsWith("@")
          ? `@${conversationFilter} ${chatInput.trim()}`
          : chatInput.trim();

      await sendMessage({ message, sender: "Web", channel: "web" });
      setChatInput("");
    } catch {
      // send errors are transient; the message will appear via SSE if it went through
    } finally {
      setSending(false);
    }
  }, [chatInput, conversationFilter, sending]);

  const conversationEntries = useMemo<ConversationEntry[]>(() => {
    const historyEntries: ConversationEntry[] = [];
    const seenHistory = new Set<string>();

    Object.entries(agentHistories ?? {}).forEach(([agentId, messages]) => {
      messages.forEach((message, index) => {
        const dedupeKey =
          message.role === "user"
            ? `user:${message.message_id || message.id}:${message.content}`
            : `agent:${agentId}:${message.message_id || message.id}:${message.content}`;
        if (seenHistory.has(dedupeKey)) return;
        seenHistory.add(dedupeKey);

        historyEntries.push({
          id: `history-${agentId}-${message.id}`,
          timestamp: message.created_at,
          role: message.role === "user" ? "user" : "agent",
          agentId: message.role === "assistant" ? agentId : undefined,
          sender: message.role === "user" ? "You" : agents?.[agentId]?.name || `@${agentId}`,
          message: message.content,
          targetAgents: message.role === "user" ? [agentId] : [],
          sourceOrder: index,
        });
      });
    });

    const liveEntries = [...bubbles].map((bubble, index) => {
      if (bubble.agentId.startsWith("_user_")) {
        return {
          id: bubble.id,
          timestamp: bubble.timestamp,
          role: "user" as const,
          sender: "You",
          message: bubble.message,
          targetAgents: bubble.targetAgents,
          sourceOrder: index,
        };
      }

      const agent = agents?.[bubble.agentId];
      return {
        id: bubble.id,
        timestamp: bubble.timestamp,
        role: "agent" as const,
        agentId: bubble.agentId,
        sender: agent?.name || `@${bubble.agentId}`,
        message: bubble.message,
        targetAgents: bubble.targetAgents,
        sourceOrder: index,
      };
    });

    const merged = [...historyEntries, ...liveEntries];
    const seen = new Set<string>();
    return merged
      .sort((left, right) => {
        if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
        if (left.role !== right.role) return left.role === "user" ? -1 : 1;
        return left.sourceOrder - right.sourceOrder;
      })
      .filter((entry) => {
        // Use time-bucket (5s window) to deduplicate messages that arrive via
        // both SSE (live bubbles) and API polling (agent histories) with
        // slightly different timestamps.
        const timeBucket = Math.round(entry.timestamp / 5000);
        const key = `${entry.role}:${entry.agentId || "boss"}:${timeBucket}:${entry.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [agentHistories, agents, bubbles]);

  const visibleConversation = useMemo(() => {
    if (conversationFilter === "all") return conversationEntries.slice(-60);
    return conversationEntries
      .filter((entry) => {
        if (entry.role === "agent") return entry.agentId === conversationFilter;
        return entry.targetAgents.length === 0 || entry.targetAgents.includes(conversationFilter);
      })
      .slice(-60);
  }, [conversationEntries, conversationFilter]);

  useEffect(() => {
    const node = conversationScrollRef.current;
    if (!node) return;
    if (!conversationStickToBottomRef.current) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [visibleConversation]);

  const handleConversationScroll = useCallback(() => {
    const node = conversationScrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    conversationStickToBottomRef.current = distanceFromBottom <= 32;
  }, []);

  const activeButtonClass = "border-[#465e14] bg-[#111111] text-[#a3e635]";
  const inactiveButtonClass = "border-[#885c47] bg-[#dcc3a3] text-[#5c4637] hover:border-[#465e14] hover:bg-[#111111] hover:text-[#a3e635]";

  return (
    <div
      className="absolute right-0 top-0 z-40 flex flex-col overflow-hidden border-l border-[#885c47] bg-[#b38857] shadow-[-18px_0_36px_rgba(36,24,16,0.2)]"
      style={{
        width: `${(584 / PIXEL_SCENE_LAYOUT.width) * 100}%`,
        height: "100%",
      }}
    >
      <div className="border-b border-[#885c47] bg-[#be9565] px-4 py-3 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConversationFilterAndStick("all")}
            className={`border px-3 py-1.5 font-mono text-[10px] transition ${
              conversationFilter === "all" ? activeButtonClass : inactiveButtonClass
            }`}
          >
            All Agents
          </button>
          {agentEntries.map(([agentId, agent]) => (
            <button
              key={agentId}
              type="button"
              onClick={() => setConversationFilterAndStick(agentId)}
              className={`border px-3 py-1.5 font-mono text-[10px] transition ${
                conversationFilter === agentId ? activeButtonClass : inactiveButtonClass
              }`}
            >
              {agent.name || `@${agentId}`}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={conversationScrollRef}
        onScroll={handleConversationScroll}
        className="min-h-0 flex-1 overflow-y-auto border-y border-[#885c47] bg-[#ead8c3] px-4 py-4"
      >
        <div className="space-y-3">
          {visibleConversation.length > 0 ? (
            visibleConversation.map((entry) => {
              const isUser = entry.role === "user";
              const initials = entry.sender.slice(0, 2).toUpperCase();
              return (
                <div key={entry.id} className="flex items-start gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center text-[10px] font-bold uppercase shrink-0 text-white ${
                      isUser ? "bg-[#465e14]" : agentColor(entry.agentId ?? "")
                    }`}
                  >
                    {isUser ? "You" : initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-[#241b16]">{entry.sender}</span>
                      <span className="text-[10px] text-[#6f5c4b]">
                        {timeAgo(entry.timestamp)}
                      </span>
                    </div>
                    <Markdown className="prose prose-sm mt-0.5 max-w-none break-words text-[#241b16]/90 [&_span.rounded-sm]:bg-[#d4c4a8] [&_span.rounded-sm]:text-[#5c4637]">
                      {entry.message}
                    </Markdown>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="border border-dashed border-[#885c47] bg-[#f4e7d6] px-4 py-6 text-center text-sm text-[#6f5c4b]">
              No messages for this view
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[#885c47] bg-[#be9565] px-4 py-3 shadow-[0_-1px_0_rgba(255,255,255,0.08)_inset]">
        <PromptInput
          value={chatInput}
          onValueChange={setChatInput}
          isLoading={sending}
          onSubmit={handleSend}
          className="relative w-full rounded-none border-[#885c47] bg-[#f4e7d6] shadow-none"
        >
          <PromptInputTextarea
            placeholder={conversationFilter === "all" ? "Message @agent or @team..." : `Message @${conversationFilter}...`}
            className="min-h-[70px] text-[#241b16] placeholder:text-[#6f5c4b]"
          />
          <PromptInputActions className="absolute bottom-2 right-2">
            <PromptInputAction
              tooltip={sending ? "Sending..." : "Send message"}
            >
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-full border-[#465e14] bg-[#161812] text-[#a3e635] hover:bg-[#465e14] hover:text-[#d9f99d]"
                disabled={!chatInput.trim() || sending}
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
