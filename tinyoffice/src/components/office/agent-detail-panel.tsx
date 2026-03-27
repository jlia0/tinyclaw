"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ArrowUp, Square, X, Bot, Swords, FileText, Brain, HeartPulse, CalendarDays } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { Markdown } from "@/components/ui/markdown";
import { PIXEL_SCENE_LAYOUT } from "./pixel-office-scene";
import {
  sendMessage,
  getAgentSkills,
  getAgentSystemPrompt,
  saveAgentSystemPrompt,
  getAgentMemory,
  getAgentHeartbeat,
  saveAgentHeartbeat,
  type AgentConfig,
  type AgentMessage,
  type WorkspaceSkill,
} from "@/lib/api";
import { timeAgo } from "@/lib/hooks";
import type { ConversationEntry, LiveBubble } from "./types";
import { type SkillEntry } from "@/components/agent/skills-constellation";
import {
  SkillsTab,
  ScheduleTab,
  SystemPromptTab,
  MemoryTab,
  HeartbeatTab,
} from "@/components/agent";

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

type TabId = "chat" | "skills" | "schedule" | "system-prompt" | "memory" | "heartbeat";

const TABS: { id: TabId; label: string; icon: typeof Bot }[] = [
  { id: "chat", label: "Chat", icon: Bot },
  { id: "skills", label: "Skills", icon: Swords },
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "system-prompt", label: "Prompt", icon: FileText },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "heartbeat", label: "Heartbeat", icon: HeartPulse },
];

type AgentDetailPanelProps = {
  agentId: string;
  agents: Record<string, AgentConfig> | null;
  agentEntries: [string, AgentConfig][];
  agentHistories: Record<string, AgentMessage[]> | null;
  bubbles: LiveBubble[];
  onClose: () => void;
};

export function AgentDetailPanel({
  agentId,
  agents,
  agentHistories,
  bubbles,
  onClose,
}: AgentDetailPanelProps) {
  const agent = agents?.[agentId];
  const [activeTab, setActiveTab] = useState<TabId>("chat");

  // Workspace data
  const [workspaceSkills, setWorkspaceSkills] = useState<WorkspaceSkill[]>([]);
  const [systemPromptContent, setSystemPromptContent] = useState("");
  const [systemPromptPath, setSystemPromptPath] = useState("");
  const [systemPromptLoaded, setSystemPromptLoaded] = useState(false);
  const [memoryIndex, setMemoryIndex] = useState("");
  const [memoryFiles, setMemoryFiles] = useState<{ name: string; path: string }[]>([]);
  const [memoryDir, setMemoryDir] = useState("");
  const [heartbeatContent, setHeartbeatContent] = useState("");
  const [heartbeatPath, setHeartbeatPath] = useState("");
  const [heartbeatLoaded, setHeartbeatLoaded] = useState(false);
  const [heartbeatInterval, setHeartbeatInterval] = useState("300");
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [spSaving, setSpSaving] = useState(false);
  const [spSaved, setSpSaved] = useState(false);
  const [hbSaving, setHbSaving] = useState(false);
  const [hbSaved, setHbSaved] = useState(false);

  // Load workspace data when agent changes
  useEffect(() => {
    if (!agent) return;
    setSystemPromptLoaded(false);
    setHeartbeatLoaded(false);

    getAgentSkills(agentId).then(setWorkspaceSkills).catch(() => {});
    getAgentSystemPrompt(agentId)
      .then((data) => {
        setSystemPromptContent(data.content);
        setSystemPromptPath(data.path);
        setSystemPromptLoaded(true);
      })
      .catch(() => setSystemPromptLoaded(true));
    getAgentMemory(agentId)
      .then((data) => {
        setMemoryIndex(data.index);
        setMemoryFiles(data.files);
        setMemoryDir(data.memoryDir);
      })
      .catch(() => {});
    getAgentHeartbeat(agentId)
      .then((data) => {
        setHeartbeatContent(data.content);
        setHeartbeatPath(data.path);
        setHeartbeatEnabled(data.enabled);
        if (data.interval != null) setHeartbeatInterval(String(data.interval));
        setHeartbeatLoaded(true);
      })
      .catch(() => setHeartbeatLoaded(true));
  }, [agent, agentId]);

  const constellationSkills: SkillEntry[] = workspaceSkills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
  }));

  const handleSaveSystemPrompt = useCallback(async () => {
    if (!agent) return;
    setSpSaving(true);
    try {
      await saveAgentSystemPrompt(agentId, systemPromptContent);
      setSpSaved(true);
      setTimeout(() => setSpSaved(false), 2000);
    } catch {
      // Error
    } finally {
      setSpSaving(false);
    }
  }, [agent, agentId, systemPromptContent]);

  const handleSaveHeartbeat = useCallback(async () => {
    if (!agent) return;
    setHbSaving(true);
    try {
      await saveAgentHeartbeat(agentId, {
        content: heartbeatContent,
        enabled: heartbeatEnabled,
        interval: parseInt(heartbeatInterval) || 300,
      });
      setHbSaved(true);
      setTimeout(() => setHbSaved(false), 2000);
    } catch {
      // Error
    } finally {
      setHbSaving(false);
    }
  }, [agent, agentId, heartbeatContent, heartbeatEnabled, heartbeatInterval]);

  const refreshWorkspaceData = useCallback(() => {
    getAgentSkills(agentId).then(setWorkspaceSkills).catch(() => {});
    getAgentMemory(agentId)
      .then((data) => {
        setMemoryIndex(data.index);
        setMemoryFiles(data.files);
        setMemoryDir(data.memoryDir);
      })
      .catch(() => {});
  }, [agentId]);

  if (!agent) {
    return (
      <div
        className="absolute right-0 top-0 z-40 flex flex-col items-center justify-center overflow-hidden border-l border-[#885c47] bg-[#b38857]"
        style={{
          width: `${(584 / PIXEL_SCENE_LAYOUT.width) * 100}%`,
          height: "100%",
        }}
      >
        <p className="text-sm text-[#5c4637]">Agent not found</p>
      </div>
    );
  }

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
      {/* Agent header */}
      <div className="border-b border-[#885c47] bg-[#be9565] px-4 py-2 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-8 w-8 items-center justify-center text-white text-[10px] font-bold uppercase shrink-0", agentColor(agentId))}>
            {agent.name.slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#241b16] truncate">{agent.name}</p>
            <p className="text-[10px] text-[#6f5c4b]">{agent.provider}/{agent.model}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#6f5c4b] hover:text-[#241b16] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#885c47] bg-[#be9565] px-2 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-2.5 py-2 text-[10px] font-medium transition-colors whitespace-nowrap ${
                active
                  ? "text-[#241b16]"
                  : "text-[#6f5c4b] hover:text-[#241b16]"
              }`}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "chat" && (
          <ChatTabContent
            agentId={agentId}
            agents={agents}
            agentHistories={agentHistories}
            bubbles={bubbles}
          />
        )}
        {activeTab === "skills" && (
          <div className="h-full overflow-auto bg-[#ead8c3]">
            <SkillsTab
              skills={constellationSkills}
              agentName={agent.name}
              agentInitials={agent.name.slice(0, 2).toUpperCase()}
              onRefresh={refreshWorkspaceData}
              agentId={agentId}
            />
          </div>
        )}
        {activeTab === "schedule" && (
          <div className="h-full overflow-auto bg-[#ead8c3]">
            <ScheduleTab agentId={agentId} />
          </div>
        )}
        {activeTab === "system-prompt" && (
          <div className="h-full overflow-auto bg-[#ead8c3]">
            <SystemPromptTab
              content={systemPromptContent}
              filePath={systemPromptPath}
              loaded={systemPromptLoaded}
              onChange={setSystemPromptContent}
              onSave={handleSaveSystemPrompt}
              saving={spSaving}
              saved={spSaved}
            />
          </div>
        )}
        {activeTab === "memory" && (
          <div className="h-full overflow-auto bg-[#ead8c3]">
            <MemoryTab
              memoryIndex={memoryIndex}
              memoryFiles={memoryFiles}
              memoryDir={memoryDir}
              onRefresh={refreshWorkspaceData}
            />
          </div>
        )}
        {activeTab === "heartbeat" && (
          <div className="h-full overflow-auto bg-[#ead8c3]">
            <HeartbeatTab
              content={heartbeatContent}
              filePath={heartbeatPath}
              loaded={heartbeatLoaded}
              onChange={setHeartbeatContent}
              enabled={heartbeatEnabled}
              onToggle={() => setHeartbeatEnabled(!heartbeatEnabled)}
              interval={heartbeatInterval}
              onIntervalChange={setHeartbeatInterval}
              onSave={handleSaveHeartbeat}
              saving={hbSaving}
              saved={hbSaved}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Chat tab (extracted from ConversationPanel, filtered to single agent) ──

function ChatTabContent({
  agentId,
  agents,
  agentHistories,
  bubbles,
}: {
  agentId: string;
  agents: Record<string, AgentConfig> | null;
  agentHistories: Record<string, AgentMessage[]> | null;
  bubbles: LiveBubble[];
}) {
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const handleSend = useCallback(async () => {
    if (!chatInput.trim() || sending) return;
    setSending(true);
    try {
      const message = chatInput.trim().startsWith("@")
        ? chatInput.trim()
        : `@${agentId} ${chatInput.trim()}`;
      await sendMessage({ message, sender: "Web", channel: "web" });
      setChatInput("");
    } catch {
      // transient
    } finally {
      setSending(false);
    }
  }, [chatInput, agentId, sending]);

  const conversationEntries = useMemo<ConversationEntry[]>(() => {
    const historyEntries: ConversationEntry[] = [];
    const seenHistory = new Set<string>();

    // Only show this agent's history
    const agentMessages = agentHistories?.[agentId] ?? [];
    agentMessages.forEach((message, index) => {
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

    // Filter bubbles for this agent
    const liveEntries = bubbles
      .filter((b) => b.agentId === agentId || b.targetAgents.includes(agentId) || b.agentId.startsWith("_user_"))
      .map((bubble, index) => {
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
        return {
          id: bubble.id,
          timestamp: bubble.timestamp,
          role: "agent" as const,
          agentId: bubble.agentId,
          sender: agents?.[bubble.agentId]?.name || `@${bubble.agentId}`,
          message: bubble.message,
          targetAgents: bubble.targetAgents,
          sourceOrder: index,
        };
      });

    const merged = [...historyEntries, ...liveEntries];
    const seen = new Set<string>();
    return merged
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        if (a.role !== b.role) return a.role === "user" ? -1 : 1;
        return a.sourceOrder - b.sourceOrder;
      })
      .filter((entry) => {
        const timeBucket = Math.round(entry.timestamp / 5000);
        const key = `${entry.role}:${entry.agentId || "boss"}:${timeBucket}:${entry.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(-60);
  }, [agentHistories, agents, bubbles, agentId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !stickToBottomRef.current) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [conversationEntries]);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 32;
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto border-y border-[#885c47] bg-[#ead8c3] px-4 py-4"
      >
        <div className="space-y-3">
          {conversationEntries.length > 0 ? (
            conversationEntries.map((entry) => {
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
              No messages with this agent yet
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
            placeholder={`Message @${agentId}...`}
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
