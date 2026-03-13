"use client";

import { useState, useCallback, useEffect, use } from "react";
import { usePolling } from "@/lib/hooks";
import {
  getAgents,
  getSettings,
  saveAgent,
  updateSettings,
  getAgentSkills,
  getAgentSystemPrompt,
  saveAgentSystemPrompt,
  getAgentMemory,
  getAgentHeartbeat,
  saveAgentHeartbeat,
  searchRegistrySkills,
  installRegistrySkill,
  type AgentConfig,
  type Settings,
  type WorkspaceSkill,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  SkillsConstellation,
  type SkillEntry,
} from "@/components/skills-constellation";
import { AgentChatView } from "@/components/agent-chat-view";
import {
  Bot,
  Swords,
  FileText,
  Brain,
  HeartPulse,
  ArrowLeft,
  Check,
  Loader2,
  Save,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";

type TabId = "chat" | "skills" | "system-prompt" | "memory" | "heartbeat";

const TABS: { id: TabId; label: string; icon: typeof Swords }[] = [
  { id: "chat", label: "Chat", icon: Bot },
  { id: "skills", label: "Skills", icon: Swords },
  { id: "system-prompt", label: "System Prompt", icon: FileText },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "heartbeat", label: "Heartbeat", icon: HeartPulse },
];

export default function AgentConfigPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: agentId } = use(params);
  const { data: agents, refresh } = usePolling<Record<string, AgentConfig>>(
    getAgents,
    0,
  );
  const { data: settings } = usePolling<Settings>(getSettings, 0);

  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Workspace data
  const [workspaceSkills, setWorkspaceSkills] = useState<WorkspaceSkill[]>([]);
  const [systemPromptContent, setSystemPromptContent] = useState<string>("");
  const [systemPromptPath, setSystemPromptPath] = useState<string>("");
  const [systemPromptLoaded, setSystemPromptLoaded] = useState(false);
  const [memoryIndex, setMemoryIndex] = useState<string>("");
  const [memoryFiles, setMemoryFiles] = useState<
    { name: string; path: string }[]
  >([]);
  const [memoryDir, setMemoryDir] = useState<string>("");
  const [heartbeatContent, setHeartbeatContent] = useState<string>("");
  const [heartbeatPath, setHeartbeatPath] = useState<string>("");
  const [heartbeatLoaded, setHeartbeatLoaded] = useState(false);

  // Heartbeat UI state
  const [heartbeatInterval, setHeartbeatInterval] = useState("300");
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);

  const agent = agents?.[agentId];

  // Load workspace data when agent is available
  useEffect(() => {
    if (!agent) return;

    getAgentSkills(agentId)
      .then(setWorkspaceSkills)
      .catch(() => {});

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
        setHeartbeatLoaded(true);
      })
      .catch(() => setHeartbeatLoaded(true));
  }, [agent, agentId]);

  // Sync heartbeat interval from settings unless the user has edited it
  useEffect(() => {
    if (!settings?.monitoring) return;
    const interval = settings.monitoring.heartbeat_interval;
    if (typeof interval === "number") {
      setHeartbeatInterval(String(interval));
    }
  }, [settings]);

  // Convert workspace skills to SkillEntry format for constellation
  const constellationSkills: SkillEntry[] = workspaceSkills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
  }));

  const handleSave = useCallback(async () => {
    if (!agent) return;
    setSaving(true);
    try {
      await saveAgent(agentId, agent);

      // Save system prompt to AGENTS.md
      await saveAgentSystemPrompt(agentId, systemPromptContent);

      // Save heartbeat.md
      await saveAgentHeartbeat(agentId, heartbeatContent);

      if (settings?.monitoring) {
        await updateSettings({
          monitoring: {
            ...settings.monitoring,
            heartbeat_interval: parseInt(heartbeatInterval) || 300,
          },
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      refresh();
    } catch {
      // Error handling
    } finally {
      setSaving(false);
    }
  }, [
    agent,
    agentId,
    systemPromptContent,
    heartbeatContent,
    heartbeatInterval,
    settings,
    refresh,
  ]);

  const refreshWorkspaceData = useCallback(() => {
    getAgentSkills(agentId)
      .then(setWorkspaceSkills)
      .catch(() => {});
    getAgentMemory(agentId)
      .then((data) => {
        setMemoryIndex(data.index);
        setMemoryFiles(data.files);
        setMemoryDir(data.memoryDir);
      })
      .catch(() => {});
  }, [agentId]);

  if (!agents) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          Loading...
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-12 text-center">
            <Bot className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">Agent not found</p>
            <p className="text-sm text-muted-foreground mt-1">
              No agent with ID &quot;{agentId}&quot; exists
            </p>
            <Link href="/agents">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="h-4 w-4" />
                Back to Agents
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <Link
            href="/agents"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center bg-primary/10 text-primary text-sm font-bold uppercase">
              {agent.name.slice(0, 2)}
            </div>
            <div>
              <h1 className="text-base font-semibold flex items-center gap-2">
                {agent.name}
                <Badge variant="outline" className="text-[10px] font-mono">
                  @{agentId}
                </Badge>
              </h1>
              <p className="text-xs text-muted-foreground">
                {agent.provider}/{agent.model}
              </p>
            </div>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saved ? "Saved" : "Save"}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b bg-card px-6">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors
                border-b-2 -mb-px
                ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }
              `}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.id === "skills" && workspaceSkills.length > 0 && (
                <span className="text-[9px] text-muted-foreground ml-1">
                  ({workspaceSkills.length})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "chat" && (
          <div className="h-full min-h-0">
            <AgentChatView agentId={agentId} agentName={agent.name} />
          </div>
        )}
        {activeTab === "skills" && (
          <SkillsTab
            skills={constellationSkills}
            agentName={agent.name}
            agentInitials={agent.name.slice(0, 2).toUpperCase()}
            onRefresh={refreshWorkspaceData}
            agentId={agentId}
          />
        )}
        {activeTab === "system-prompt" && (
          <SystemPromptTab
            content={systemPromptContent}
            filePath={systemPromptPath}
            loaded={systemPromptLoaded}
            onChange={setSystemPromptContent}
          />
        )}
        {activeTab === "memory" && (
          <MemoryTab
            memoryIndex={memoryIndex}
            memoryFiles={memoryFiles}
            memoryDir={memoryDir}
            agentId={agentId}
            onRefresh={refreshWorkspaceData}
          />
        )}
        {activeTab === "heartbeat" && (
          <HeartbeatTab
            content={heartbeatContent}
            filePath={heartbeatPath}
            loaded={heartbeatLoaded}
            onChange={setHeartbeatContent}
            enabled={heartbeatEnabled}
            onToggle={() => setHeartbeatEnabled(!heartbeatEnabled)}
            interval={heartbeatInterval}
            onIntervalChange={setHeartbeatInterval}
          />
        )}
      </div>
    </div>
  );
}

// ── Skills Tab ──────────────────────────────────────────────────────────────

function SkillsTab({
  skills,
  agentName,
  agentInitials,
  onRefresh,
  agentId,
}: {
  skills: SkillEntry[];
  agentName: string;
  agentInitials: string;
  onRefresh: () => void;
  agentId: string;
}) {
  const [search, setSearch] = useState("");
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryResults, setRegistryResults] = useState<
    { ref: string; installs?: string; url?: string }[]
  >([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [installingRef, setInstallingRef] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [registryOpen, setRegistryOpen] = useState(false);

  const filtered = skills.filter((s) => {
    if (
      search &&
      !s.name.toLowerCase().includes(search.toLowerCase()) &&
      !s.description.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  const runRegistrySearch = async () => {
    const q = registryQuery.trim();
    if (!q) return;
    setRegistryLoading(true);
    setRegistryError(null);
    setInstallMessage(null);
    try {
      const res = await searchRegistrySkills(agentId, q);
      setRegistryResults(res.results || []);
    } catch (err) {
      setRegistryError((err as Error).message);
      setRegistryResults([]);
    } finally {
      setRegistryLoading(false);
    }
  };

  const handleInstall = async (ref: string) => {
    setInstallingRef(ref);
    setRegistryError(null);
    setInstallMessage(null);
    try {
      await installRegistrySkill(agentId, ref);
      setInstallMessage(`Installed ${ref}.`);
      onRefresh();
    } catch (err) {
      setRegistryError((err as Error).message);
    } finally {
      setInstallingRef(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filters bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b bg-card/50">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
          className="max-w-xs h-8 text-xs"
        />
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors border border-border"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRegistryOpen(true)}
        >
          Registry Search
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {filtered.length} skills
          </span>
        </div>
      </div>

      {registryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-3xl bg-card border shadow-lg">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="text-sm font-semibold">Registry Search</div>
              <button
                onClick={() => setRegistryOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={registryQuery}
                  onChange={(e) => setRegistryQuery(e.target.value)}
                  placeholder="Search skills registry (skills.sh)..."
                  className="flex-1 h-9 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runRegistrySearch();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={runRegistrySearch}
                  disabled={registryLoading || !registryQuery.trim()}
                >
                  {registryLoading ? "Searching..." : "Search"}
                </Button>
              </div>
              {registryError && (
                <div className="text-[11px] text-destructive">
                  {registryError}
                </div>
              )}
              {installMessage && (
                <div className="text-[11px] text-primary">{installMessage}</div>
              )}
              {registryResults.length > 0 && (
                <div className="space-y-2">
                  {registryResults.map((r) => (
                    <div
                      key={r.ref}
                      className="flex items-center gap-3 px-3 py-2 border bg-card/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {r.ref}
                        </div>
                        {r.installs && (
                          <div className="text-[10px] text-muted-foreground">
                            {r.installs} installs
                          </div>
                        )}
                        {r.url && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {r.url}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleInstall(r.ref)}
                        disabled={installingRef === r.ref}
                      >
                        {installingRef === r.ref ? "Installing..." : "Install"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Constellation */}
      {filtered.length > 0 ? (
        <div className="flex-1">
          <SkillsConstellation
            skills={filtered}
            agentName={agentName}
            agentInitials={agentInitials}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Swords className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No skills found in workspace</p>
            <p className="text-xs mt-1">
              Skills are loaded from{" "}
              <code className="bg-muted px-1 py-0.5 text-[10px] font-mono">
                .agents/skills/
              </code>{" "}
              in the agent workspace
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── System Prompt Tab ───────────────────────────────────────────────────────

function SystemPromptTab({
  content,
  filePath,
  loaded,
  onChange,
}: {
  content: string;
  filePath: string;
  loaded: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            System Prompt
            <span className="text-[10px] text-muted-foreground font-normal">
              AGENTS.md
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-secondary/50 border">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              Loaded from{" "}
              <code className="bg-muted px-1 py-0.5 font-mono text-[10px]">
                {filePath || "AGENTS.md"}
              </code>{" "}
              in the agent workspace. Changes are saved back to this file.
            </p>
          </div>

          {!loaded ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading...</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Agent Instructions
              </label>
              <p className="text-[11px] text-muted-foreground/70 mb-2">
                This is the agent&apos;s AGENTS.md file — it defines behavior,
                team communication, memory index, and other persistent
                instructions.
              </p>
              <Textarea
                value={content}
                onChange={(e) => onChange(e.target.value)}
                placeholder="# Agent Instructions&#10;&#10;Define this agent's behavior and instructions..."
                rows={28}
                className="text-sm font-mono"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {content.length} characters &middot;{" "}
                  {content.split("\n").length} lines
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Markdown
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Memory Tab ──────────────────────────────────────────────────────────────

function MemoryTab({
  memoryIndex,
  memoryFiles,
  memoryDir,
  agentId,
  onRefresh,
}: {
  memoryIndex: string;
  memoryFiles: { name: string; path: string }[];
  memoryDir: string;
  agentId: string;
  onRefresh: () => void;
}) {
  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Agent Memory
            <button
              onClick={onRefresh}
              className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-secondary/50 border">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              Memory files loaded from{" "}
              <code className="bg-muted px-1 py-0.5 font-mono text-[10px]">
                {memoryDir || `memory/`}
              </code>{" "}
              in the agent workspace. The agent manages its own memory using the
              memory skill.
            </p>
          </div>

          {/* Memory index */}
          {memoryIndex ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Memory Index
              </label>
              <div className="p-5 bg-card border font-mono text-xs whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {memoryIndex}
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-muted-foreground">
              <Brain className="h-6 w-6 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No memories yet</p>
              <p className="text-xs mt-1">
                The agent will build memories as it works using the memory
                skill.
              </p>
            </div>
          )}

          {/* File listing */}
          {memoryFiles.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Memory Files ({memoryFiles.length})
              </label>
              <div className="border divide-y">
                {memoryFiles.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 px-3 py-2 text-xs"
                  >
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-mono text-muted-foreground">
                      {file.path}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Conversation History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 p-3 bg-secondary/50 border">
            <p className="text-xs text-muted-foreground">
              Recent conversations are stored in the agent&apos;s message
              history. View conversation history from the{" "}
              <Link
                href={`/chat/agent/${agentId}`}
                className="text-primary hover:underline"
              >
                chat view
              </Link>
              .
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Heartbeat Tab ───────────────────────────────────────────────────────────

function HeartbeatTab({
  content,
  filePath,
  loaded,
  onChange,
  enabled,
  onToggle,
  interval,
  onIntervalChange,
}: {
  content: string;
  filePath: string;
  loaded: boolean;
  onChange: (v: string) => void;
  enabled: boolean;
  onToggle: () => void;
  interval: string;
  onIntervalChange: (v: string) => void;
}) {
  const intervalSec = parseInt(interval) || 300;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-primary" />
            Heartbeat Monitor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Toggle */}
          <div className="flex items-center justify-between p-3 bg-secondary/50 border">
            <div>
              <p className="text-sm font-medium">Heartbeat Enabled</p>
              <p className="text-xs text-muted-foreground">
                Periodically wake the agent to check tasks and process work
              </p>
            </div>
            <button
              onClick={onToggle}
              className={`
                relative h-6 w-11 transition-colors border
                ${enabled ? "bg-primary border-primary" : "bg-muted border-border"}
              `}
            >
              <span
                className={`
                  absolute top-0.5 h-4.5 w-4.5 bg-white transition-transform
                  ${enabled ? "left-5" : "left-0.5"}
                `}
              />
            </button>
          </div>

          {enabled && (
            <>
              {/* Interval */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Interval (seconds)
                </label>
                <Input
                  type="number"
                  value={interval}
                  onChange={(e) => onIntervalChange(e.target.value)}
                  min={30}
                  max={3600}
                  className="max-w-[200px] font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Every{" "}
                  {intervalSec >= 60
                    ? `${Math.floor(intervalSec / 60)}m ${intervalSec % 60 ? `${intervalSec % 60}s` : ""}`
                    : `${intervalSec}s`}{" "}
                  the agent will wake up and execute the heartbeat prompt
                </p>
              </div>

              {/* Heartbeat prompt from file */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Heartbeat Prompt
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    from{" "}
                    <code className="bg-muted px-1 py-0.5 font-mono text-[10px]">
                      {filePath || "heartbeat.md"}
                    </code>
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground/70 mb-2">
                  What should the agent do each heartbeat cycle? Loaded from
                  heartbeat.md in the workspace.
                </p>
                {!loaded ? (
                  <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading...</span>
                  </div>
                ) : (
                  <Textarea
                    value={content}
                    onChange={(e) => onChange(e.target.value)}
                    rows={10}
                    className="text-sm font-mono"
                    placeholder="Check your tasks, process pending work..."
                  />
                )}
              </div>

              {/* Status visualization */}
              <div className="border-t pt-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 bg-primary animate-pulse-dot" />
                    <span className="text-xs text-muted-foreground">
                      Active
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/50">
                    |
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Next beat in ~{Math.floor(intervalSec / 2)}s
                  </span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
