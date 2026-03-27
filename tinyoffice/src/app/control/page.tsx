"use client";

import { useState } from "react";
import { usePolling, useSSE, timeAgo } from "@/lib/hooks";
import {
  getAgents,
  getTeams,
  getQueueStatus,
  getProcessingMessages,
  killAgentSession,
  getSystemStatus,
  getSettings,
  updateSettings,
  restartService,
  startChannel,
  stopChannel,
  restartChannel,
  getPairings,
  approvePairing,
  revokePairing,
  dismissPending,
  getCustomProviders,
  saveCustomProvider,
  deleteCustomProvider,
  getLogs,
  checkConnection,
  getApiBase,
  setApiBase,
  type AgentConfig,
  type TeamConfig,
  type QueueStatus,
  type ProcessingMessage,
  type EventData,
  type CustomProvider,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  Users,
  Cpu,
  Square,
  Loader2,
  Activity,
  RefreshCw,
  Play,
  RotateCw,
  X,
  Check,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  ScrollText,
  WifiOff,
  Wifi,
  Pencil,
} from "lucide-react";

const TABS = ["Overview", "Services", "Logs"] as const;
type Tab = (typeof TABS)[number];

// ── Page ──────────────────────────────────────────────────────────────────

export default function ControlPlanePage() {
  const [tab, setTab] = useState<Tab>("Overview");
  const { data: status, loading, refresh } = usePolling(getSystemStatus, 5000);
  const disconnected = !loading && !status;

  if (disconnected) {
    return <DisconnectedSplash onReconnect={refresh} />;
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Control Plane</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Monitor and manage your TinyAGI system
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              tab === t
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
            {t === "Services" && <PairingBadge />}
            {tab === t && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
            )}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab />}
      {tab === "Services" && <ServicesTab />}
      {tab === "Logs" && <LogsTab />}
    </div>
  );
}

// ── Disconnected splash ───────────────────────────────────────────────────

function DisconnectedSplash({ onReconnect }: { onReconnect: () => void }) {
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [checking, setChecking] = useState(false);

  async function handleConnect() {
    setChecking(true);
    const ok = await checkConnection(apiUrl);
    if (ok) {
      if (apiUrl !== getApiBase()) setApiBase(apiUrl);
      onReconnect();
    }
    setChecking(false);
  }

  function handleReset() {
    const defaultUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777";
    setApiUrl(defaultUrl);
    setApiBase(null);
  }

  return (
    <div className="p-8">
      <div className="max-w-md mx-auto mt-20 space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <WifiOff className="h-6 w-6 text-muted-foreground" />
            </div>
          </div>
          <h2 className="text-lg font-semibold">Cannot connect to TinyAGI</h2>
          <p className="text-sm text-muted-foreground">
            Make sure the daemon is running, or update the server address below.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              placeholder="http://localhost:3777"
              className="flex-1 px-3 py-2 text-sm border bg-background rounded"
            />
            <button
              onClick={handleConnect}
              disabled={checking || !apiUrl}
              className="px-4 py-2 text-sm bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 rounded"
            >
              {checking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Connect"
              )}
            </button>
          </div>
          {apiUrl !== (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777") && (
            <button onClick={handleReset} className="text-xs text-muted-foreground hover:text-primary">
              Reset to default
            </button>
          )}
        </div>

        <div className="text-left bg-muted/50 border rounded p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Get started</p>
          <div className="text-sm space-y-1.5">
            <p>1. Follow the installation guide at{" "}
              <a
                href="https://github.com/tinyagi/tinyagi"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                github.com/tinyagi/tinyagi
              </a>
            </p>
            <p>2. Run <code className="px-1.5 py-0.5 bg-background border rounded text-xs font-mono">tinyagi</code> to install and start</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pairing badge ─────────────────────────────────────────────────────────

function PairingBadge() {
  const { data: pairings } = usePolling(getPairings, 10000);
  const count = pairings?.pending?.length ?? 0;
  if (count === 0) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-bold bg-yellow-500 text-white rounded-full">
      {count}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════

function OverviewTab() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const { data: queue } = usePolling<QueueStatus>(getQueueStatus, 2000);
  const { data: processing, refresh: refreshProcessing } =
    usePolling<ProcessingMessage[]>(getProcessingMessages, 3000);

  const agentCount = agents ? Object.keys(agents).length : 0;
  const teamCount = teams ? Object.keys(teams).length : 0;

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label="Agents" value={agentCount} />
        <MiniStat label="Teams" value={teamCount} />
        <MiniStat label="Incoming" value={queue?.incoming ?? 0} accent={!!queue?.incoming} />
        <MiniStat label="Queued" value={queue?.queued ?? 0} accent={!!queue?.queued} />
        <MiniStat label="Processing" value={queue?.processing ?? 0} accent={!!queue?.processing} />
        <MiniStat label="Outgoing" value={queue?.outgoing ?? 0} />
      </div>

      {/* Agent Sessions — always visible */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Cpu className="h-3.5 w-3.5 text-primary" />
            Agent Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {processing && processing.length > 0 ? (
            <div className="space-y-2">
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
          ) : (
            <p className="text-sm text-muted-foreground">No active sessions</p>
          )}
        </CardContent>
      </Card>

      {/* Agents + Teams */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-primary" />
              Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            {agents && Object.keys(agents).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(agents).map(([id, agent]) => (
                  <div key={id} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center bg-secondary text-[10px] font-bold uppercase">
                        {agent.name.slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-medium leading-tight">{agent.name}</p>
                        <p className="text-[11px] text-muted-foreground">@{id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">{agent.provider}</Badge>
                      <Badge variant="outline" className="text-[10px]">{agent.model}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No agents configured</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-primary" />
              Teams
            </CardTitle>
          </CardHeader>
          <CardContent>
            {teams && Object.keys(teams).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(teams).map(([id, team]) => (
                  <div key={id} className="flex items-center justify-between py-1.5">
                    <div>
                      <p className="text-sm font-medium leading-tight">{team.name}</p>
                      <p className="text-[11px] text-muted-foreground">@{id}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">lead: @{team.leader_agent}</Badge>
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
    </div>
  );
}

// ── Mini stat ─────────────────────────────────────────────────────────────

function MiniStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="border bg-card px-4 py-3">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-0.5 ${accent ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICES TAB (API + Daemon + Channels + Providers + Pairing)
// ═══════════════════════════════════════════════════════════════════════════

function ServicesTab() {
  return (
    <div className="space-y-6 max-w-2xl">
      <ApiConnectionSection />
      <DaemonSection />
      <ChannelsSection />
      <BuiltinProviders />
      <CustomProviders />
      <PairingSection />
    </div>
  );
}

// ── API Connection ────────────────────────────────────────────────────────

function ApiConnectionSection() {
  const [editingUrl, setEditingUrl] = useState(false);
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [checking, setChecking] = useState(false);

  const handleSave = async () => {
    setChecking(true);
    const ok = await checkConnection(apiUrl);
    if (ok) {
      setApiBase(apiUrl);
      setEditingUrl(false);
    }
    setChecking(false);
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Wifi className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
            <p className="text-sm font-semibold">API Connection</p>
            {!editingUrl && (
              <p className="text-xs text-muted-foreground">{getApiBase()}</p>
            )}
          </div>
          {!editingUrl ? (
            <button
              onClick={() => { setApiUrl(getApiBase()); setEditingUrl(true); }}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded"
              title="Change server address"
            >
              <Pencil className="h-3 w-3" />
            </button>
          ) : (
            <button
              onClick={() => setEditingUrl(false)}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {editingUrl && (
          <div className="flex gap-2 mt-3">
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="http://localhost:3777"
              className="flex-1 px-2.5 py-1.5 text-sm border bg-background rounded"
            />
            <button
              onClick={handleSave}
              disabled={checking || !apiUrl}
              className="px-3 py-1.5 text-xs bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 rounded"
            >
              {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Daemon ─────────────────────────────────────────────────────────────────

function DaemonSection() {
  const { data: status, refresh } = usePolling(getSystemStatus, 3000);
  const [restarting, setRestarting] = useState(false);

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await restartService();
      await new Promise((r) => setTimeout(r, 3000));
      refresh();
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
      refresh();
    } finally {
      setRestarting(false);
    }
  };

  const uptime = status?.uptime ?? 0;
  const uptimeStr =
    uptime < 60
      ? `${uptime}s`
      : uptime < 3600
        ? `${Math.floor(uptime / 60)}m ${uptime % 60}s`
        : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${status?.ok ? "bg-green-500" : "bg-red-500"}`} />
            <p className="text-sm font-semibold">Daemon</p>
            <p className="text-xs text-muted-foreground">
              {status?.ok
                ? `Running \u00b7 ${uptimeStr} \u00b7 port ${status.server?.port}`
                : "Not responding"}
            </p>
          </div>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 rounded"
            title="Restart daemon"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${restarting ? "animate-spin" : ""}`} />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Channels ──────────────────────────────────────────────────────────────

function ChannelsSection() {
  const { data: status, refresh } = usePolling(getSystemStatus, 3000);
  const { data: settings, refresh: refreshSettings } = usePolling(getSettings, 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newChannel, setNewChannel] = useState({ id: "telegram", token: "" });
  const [saving, setSaving] = useState(false);

  const channels = status?.channels ?? {};
  const enabled = settings?.channels?.enabled ?? [];
  const allChannels = Array.from(new Set([...enabled, ...Object.keys(channels)]));

  const act = async (id: string, action: "start" | "stop" | "restart") => {
    setBusy(id);
    try {
      if (action === "start") await startChannel(id);
      else if (action === "stop") await stopChannel(id);
      else await restartChannel(id);
      await new Promise((r) => setTimeout(r, 500));
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleAddChannel = async () => {
    if (!newChannel.token) return;
    setSaving(true);
    const channelConfig: Record<string, Record<string, string>> = {};
    channelConfig[newChannel.id] = { bot_token: newChannel.token };
    const currentEnabled = settings?.channels?.enabled ?? [];
    const updatedEnabled = currentEnabled.includes(newChannel.id)
      ? currentEnabled
      : [...currentEnabled, newChannel.id];
    await updateSettings({
      channels: { ...settings?.channels, ...channelConfig, enabled: updatedEnabled },
    });
    setSaving(false);
    setAdding(false);
    setNewChannel({ id: "telegram", token: "" });
    refreshSettings();
    await new Promise((r) => setTimeout(r, 300));
    await startChannel(newChannel.id);
    refresh();
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="text-sm font-semibold">Channels</p>
          <button
            onClick={() => setAdding(!adding)}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded"
            title="Add channel"
          >
            {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>

        {allChannels.length === 0 && !adding && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No channels configured
          </div>
        )}

        {allChannels.map((id) => {
          const ch = channels[id];
          const running = ch?.running ?? false;
          const isBusy = busy === id;
          return (
            <div key={id} className="group flex items-center justify-between px-4 py-2.5 border-b last:border-0">
              <div className="flex items-center gap-2.5">
                <span className={`h-2 w-2 rounded-full ${running ? "bg-green-500" : "bg-zinc-400"}`} />
                <span className="text-sm">{id}</span>
                {ch?.pid && (
                  <span className="text-[10px] text-muted-foreground">PID {ch.pid}</span>
                )}
              </div>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {!running ? (
                  <IconBtn icon={<Play className="h-3 w-3" />} title="Start" onClick={() => act(id, "start")} disabled={isBusy} />
                ) : (
                  <>
                    <IconBtn icon={<RotateCw className="h-3 w-3" />} title="Restart" onClick={() => act(id, "restart")} disabled={isBusy} />
                    <IconBtn icon={<Square className="h-3 w-3" />} title="Stop" onClick={() => act(id, "stop")} disabled={isBusy} variant="danger" />
                  </>
                )}
              </div>
            </div>
          );
        })}

        {adding && (
          <div className="px-4 py-3 space-y-2 border-t bg-muted/30">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newChannel.id}
                onChange={(e) => setNewChannel({ ...newChannel, id: e.target.value })}
                className="px-2 py-1.5 text-sm border bg-background rounded"
              >
                <option value="telegram">Telegram</option>
                <option value="discord">Discord</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
              <input
                type="password"
                value={newChannel.token}
                onChange={(e) => setNewChannel({ ...newChannel, token: e.target.value })}
                placeholder="Bot token"
                className="px-2 py-1.5 text-sm border bg-background rounded"
              />
            </div>
            <button
              onClick={handleAddChannel}
              disabled={saving || !newChannel.token}
              className="px-3 py-1 text-xs bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 rounded"
            >
              {saving ? "Adding..." : "Add & Start"}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Built-in Providers ────────────────────────────────────────────────────

function BuiltinProviders() {
  const { data: settings, refresh } = usePolling(getSettings, 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [oauth, setOauth] = useState("");
  const [saving, setSaving] = useState(false);

  const providers = [
    {
      id: "anthropic",
      label: "Anthropic",
      hasKey: !!settings?.models?.anthropic?.api_key,
      hasOauth: !!settings?.models?.anthropic?.oauth_token,
      supportsOauth: true,
    },
    {
      id: "openai",
      label: "OpenAI",
      hasKey: !!settings?.models?.openai?.api_key,
      hasOauth: false,
      supportsOauth: false,
    },
  ];

  const startEdit = (providerId: string) => {
    setEditing(providerId);
    const models = settings?.models as Record<string, Record<string, string>>;
    setKey(models?.[providerId]?.api_key ?? "");
    setOauth(models?.[providerId]?.oauth_token ?? "");
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    const update: Record<string, Record<string, string | undefined>> = {};
    update[editing] = {
      ...(settings?.models as Record<string, Record<string, string>>)?.[editing],
      api_key: key || undefined,
    };
    if (editing === "anthropic") {
      update[editing].oauth_token = oauth || undefined;
    }
    await updateSettings({ models: { ...settings?.models, ...update } });
    setSaving(false);
    setEditing(null);
    refresh();
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center px-4 py-3 border-b">
          <p className="text-sm font-semibold">Built-in Providers</p>
        </div>
        {providers.map((p) => (
          <div key={p.id} className="border-b last:border-0">
            <div
              className="group flex items-center justify-between px-4 py-3 cursor-pointer"
              onClick={() => editing === p.id ? setEditing(null) : startEdit(p.id)}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-medium">{p.label}</span>
                {p.hasKey && <CredBadge color="green">API Key</CredBadge>}
                {p.hasOauth && <CredBadge color="blue">OAuth</CredBadge>}
                {!p.hasKey && !p.hasOauth && <CredBadge color="zinc">Not configured</CredBadge>}
              </div>
              {editing === p.id ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
            {editing === p.id && (
              <div className="px-4 pb-4 space-y-2.5">
                <div>
                  <label className="text-xs text-muted-foreground">API Key</label>
                  <input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full mt-0.5 px-2.5 py-1.5 text-sm border bg-background rounded"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                {p.supportsOauth && (
                  <div>
                    <label className="text-xs text-muted-foreground">OAuth Token</label>
                    <input
                      type="password"
                      value={oauth}
                      onChange={(e) => setOauth(e.target.value)}
                      className="w-full mt-0.5 px-2.5 py-1.5 text-sm border bg-background rounded"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleSave(); }}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 rounded"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Custom Providers ──────────────────────────────────────────────────────

function CustomProviders() {
  const { data: providers, refresh } = usePolling(getCustomProviders, 0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    id: "", name: "", harness: "claude" as "claude" | "codex",
    base_url: "", api_key: "", model: "",
  });
  const [saving, setSaving] = useState(false);

  const entries = providers ? Object.entries(providers) : [];

  const handleAdd = async () => {
    if (!form.id || !form.name || !form.base_url || !form.api_key) return;
    setSaving(true);
    await saveCustomProvider(form.id, {
      name: form.name, harness: form.harness,
      base_url: form.base_url, api_key: form.api_key,
      model: form.model || undefined,
    });
    setSaving(false);
    setAdding(false);
    setForm({ id: "", name: "", harness: "claude", base_url: "", api_key: "", model: "" });
    refresh();
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="text-sm font-semibold">Custom Providers</p>
          <button
            onClick={() => setAdding(!adding)}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded"
          >
            {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>
        {entries.length === 0 && !adding && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No custom providers configured
          </div>
        )}
        {entries.map(([id, p]) => (
          <div key={id} className="group flex items-center justify-between px-4 py-2.5 border-b last:border-0">
            <div>
              <p className="text-sm font-medium">{p.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {id} &middot; {p.harness}
                {p.model ? ` \u00b7 ${p.model}` : ""}
                {" \u00b7 "}{p.base_url.replace(/https?:\/\//, "").slice(0, 30)}
              </p>
            </div>
            <button
              onClick={() => deleteCustomProvider(id).then(refresh)}
              className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all rounded"
              title="Remove"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        {adding && (
          <div className="px-4 py-3 space-y-2 border-t bg-muted/30">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="Provider ID" className="px-2.5 py-1.5 text-sm border bg-background rounded"
              />
              <input
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Display name" className="px-2.5 py-1.5 text-sm border bg-background rounded"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={form.harness}
                onChange={(e) => setForm({ ...form, harness: e.target.value as "claude" | "codex" })}
                className="px-2.5 py-1.5 text-sm border bg-background rounded"
              >
                <option value="claude">Claude harness</option>
                <option value="codex">Codex harness</option>
              </select>
              <input
                value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="Model (optional)" className="px-2.5 py-1.5 text-sm border bg-background rounded"
              />
            </div>
            <input
              value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              placeholder="https://api.example.com" className="w-full px-2.5 py-1.5 text-sm border bg-background rounded"
            />
            <input
              type="password" value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              placeholder="API Key" className="w-full px-2.5 py-1.5 text-sm border bg-background rounded"
            />
            <button
              onClick={handleAdd}
              disabled={saving || !form.id || !form.name || !form.base_url || !form.api_key}
              className="px-3 py-1.5 text-xs bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 rounded"
            >
              {saving ? "Saving..." : "Add Provider"}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Pairing ───────────────────────────────────────────────────────────────

function PairingSection() {
  const { data: pairings, refresh } = usePolling(getPairings, 5000);
  const [approving, setApproving] = useState<string | null>(null);

  const pending = pairings?.pending ?? [];
  const approved = pairings?.approved ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="text-sm font-semibold">Sender Pairing</p>
          {pending.length > 0 && (
            <Badge variant="outline" className="text-[10px] text-yellow-600 border-yellow-300">
              {pending.length} pending
            </Badge>
          )}
        </div>

        {/* Pending */}
        {pending.map((p) => (
          <div key={p.code} className="group flex items-center justify-between px-4 py-2.5 border-b bg-yellow-50/50 dark:bg-yellow-950/20">
            <div>
              <p className="text-sm">
                <span className="font-medium">{p.sender}</span>
                <span className="text-muted-foreground"> via {p.channel}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                Code: <span className="font-mono font-bold">{p.code}</span>
                {" \u00b7 "}{timeAgo(p.createdAt)}
              </p>
            </div>
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <IconBtn
                icon={<Check className="h-3 w-3" />}
                title="Approve"
                variant="success"
                disabled={approving === p.code}
                onClick={async () => {
                  setApproving(p.code);
                  await approvePairing(p.code);
                  refresh();
                  setApproving(null);
                }}
              />
              <IconBtn
                icon={<X className="h-3 w-3" />}
                title="Dismiss"
                variant="danger"
                onClick={async () => { await dismissPending(p.code); refresh(); }}
              />
            </div>
          </div>
        ))}

        {/* Approved */}
        {approved.length === 0 && pending.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No senders yet. They appear here when someone messages your bot.
          </div>
        )}
        {approved.map((a) => (
          <div
            key={`${a.channel}::${a.senderId}`}
            className="group flex items-center justify-between px-4 py-2.5 border-b last:border-0"
          >
            <div>
              <p className="text-sm">
                <span className="font-medium">{a.sender}</span>
                <span className="text-muted-foreground"> via {a.channel}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                Approved {timeAgo(a.approvedAt)}
              </p>
            </div>
            <IconBtn
              icon={<Trash2 className="h-3 w-3" />}
              title="Revoke"
              variant="danger"
              className="opacity-0 group-hover:opacity-100"
              onClick={async () => { await revokePairing(a.channel, a.senderId); refresh(); }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGS TAB
// ═══════════════════════════════════════════════════════════════════════════

function LogsTab() {
  const [subTab, setSubTab] = useState<"logs" | "events">("logs");
  const { data: logs, refresh: refreshLogs } = usePolling<{ lines: string[] }>(
    () => getLogs(200),
    5000
  );
  const { events } = useSSE(100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            onClick={() => setSubTab("logs")}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              subTab === "logs"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <ScrollText className="h-3 w-3 inline mr-1" />
            Queue Logs
          </button>
          <button
            onClick={() => setSubTab("events")}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              subTab === "events"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Activity className="h-3 w-3 inline mr-1" />
            Live Events
            {events.length > 0 && (
              <span className="ml-1 text-[10px] opacity-60">{events.length}</span>
            )}
          </button>
        </div>
        {subTab === "logs" && (
          <button
            onClick={() => refreshLogs()}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {subTab === "logs" ? (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
              {logs && logs.lines.length > 0 ? (
                <pre className="text-xs font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap p-4">
                  {logs.lines.map((line, i) => (
                    <LogLine key={i} line={line} />
                  ))}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">No logs yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
              {events.length > 0 ? (
                <div className="divide-y">
                  {events.map((event, i) => (
                    <div
                      key={`${event.timestamp}-${i}`}
                      className="flex items-center gap-2.5 px-4 py-2 text-sm"
                    >
                      <EventDot type={event.type} />
                      <span className="font-medium truncate flex-shrink-0 text-xs">
                        {formatEventType(event.type)}
                      </span>
                      <span className="text-muted-foreground truncate flex-1 min-w-0 text-xs">
                        {formatEventDetail(event)}
                      </span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {timeAgo(event.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">Waiting for events...</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogLine({ line }: { line: string }) {
  let levelClass = "text-muted-foreground";
  if (line.includes("[ERROR]")) levelClass = "text-destructive";
  else if (line.includes("[WARN]")) levelClass = "text-yellow-500";
  else if (line.includes("[INFO]") && line.includes("\u2713")) levelClass = "text-emerald-500";

  return (
    <div className={`${levelClass} py-0.5 border-b border-border/20`}>
      {line}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function IconBtn({
  icon, title, onClick, disabled, variant, className = "",
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "danger" | "success";
  className?: string;
}) {
  const colors = variant === "danger"
    ? "hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-950"
    : variant === "success"
      ? "hover:text-green-600 hover:bg-green-100 dark:hover:bg-green-950"
      : "hover:text-foreground hover:bg-muted";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 text-muted-foreground ${colors} transition-colors disabled:opacity-50 rounded ${className}`}
    >
      {icon}
    </button>
  );
}

function CredBadge({ color, children }: { color: "green" | "blue" | "zinc"; children: React.ReactNode }) {
  const styles = {
    green: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    zinc: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles[color]}`}>{children}</span>;
}

function AgentSessionRow({ msg, onKill }: { msg: ProcessingMessage; onKill: () => Promise<void> }) {
  const [killing, setKilling] = useState(false);
  const isStale = msg.status === "processing" && !msg.processAlive;

  return (
    <div className="group flex items-center justify-between py-2">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-secondary text-[10px] font-bold uppercase">
          {msg.agent.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium">@{msg.agent}</p>
            {isStale ? (
              <Badge variant="destructive" className="text-[10px] px-1 py-0">stale</Badge>
            ) : msg.status === "processing" ? (
              <Badge variant="default" className="bg-green-600 text-[10px] px-1 py-0">processing</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] px-1 py-0">queued</Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{msg.message}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <span className="text-[11px] text-muted-foreground tabular-nums">{formatDuration(msg.duration)}</span>
        <button
          onClick={async () => { setKilling(true); try { await onKill(); } finally { setKilling(false); } }}
          disabled={killing}
          className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all rounded"
          title="Kill session"
        >
          {killing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
        </button>
      </div>
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

function EventDot({ type }: { type: string }) {
  const colors: Record<string, string> = {
    message_received: "bg-blue-500", agent_routed: "bg-primary",
    chain_step_start: "bg-yellow-500", chain_step_done: "bg-green-500",
    response_ready: "bg-emerald-500", team_chain_start: "bg-purple-500",
    team_chain_end: "bg-purple-400", chain_handoff: "bg-orange-500",
    message_enqueued: "bg-cyan-500", processor_start: "bg-primary",
  };
  return <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors[type] || "bg-muted-foreground"}`} />;
}

function formatEventType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
