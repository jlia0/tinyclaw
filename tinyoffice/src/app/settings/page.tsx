"use client";

import { useState, useEffect } from "react";
import { getSettings, updateSettings, checkConnection, getApiBase, setApiBase, type Settings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Settings as SettingsIcon,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wifi,
  WifiOff,
  MessageSquare,
  Cpu,
  FolderOpen,
  Wand2,
  RotateCw,
} from "lucide-react";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rawJson, setRawJson] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [needsSetup, setNeedsSetup] = useState(false);

  // Connection state
  const [connected, setConnected] = useState<boolean | null>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setApiUrl(getApiBase());
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const ok = await checkConnection();
    setConnected(ok);

    if (!ok) {
      setLoading(false);
      return;
    }

    try {
      const s = await getSettings();
      setSettings(s);
      setRawJson(JSON.stringify(s, null, 2));
      const isEmpty = !s || (Object.keys(s).length === 0) ||
        (!s.agents && !s.models?.provider);
      setNeedsSetup(isEmpty);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus("error");
      setNeedsSetup(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckConnection(baseUrl?: string) {
    const target = baseUrl ?? apiUrl;
    setChecking(true);
    const ok = await checkConnection(target);
    setChecking(false);
    setConnected(ok);
    if (ok) {
      if (!process.env.NEXT_PUBLIC_API_URL || target !== process.env.NEXT_PUBLIC_API_URL) {
        setApiBase(target);
      }
      loadSettings();
    }
  }

  function handleResetUrl() {
    setApiBase(null);
    const defaultUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777";
    setApiUrl(defaultUrl);
    handleCheckConnection(defaultUrl);
  }

  const handleSave = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(rawJson);
      const result = await updateSettings(parsed);
      setSettings(result.settings);
      setRawJson(JSON.stringify(result.settings, null, 2));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 5000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          Loading settings...
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-primary" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            View and edit TinyAGI configuration
          </p>
        </div>
        {connected && settings && !needsSetup && (
          <div className="flex items-center gap-3">
            {status === "saved" && (
              <span className="flex items-center gap-1.5 text-sm text-emerald-500">
                <CheckCircle2 className="h-4 w-4" />
                Saved
              </span>
            )}
            {status === "error" && (
              <span className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {errorMsg}
              </span>
            )}
<Button onClick={handleSave} disabled={saving || loading}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Settings
            </Button>
          </div>
        )}
      </div>

      {/* Connection card — always visible */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            {connected ? (
              <Wifi className="h-4 w-4 text-emerald-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-destructive" />
            )}
            API Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://localhost:3777"
              onKeyDown={(e) => e.key === "Enter" && handleCheckConnection()}
            />
            <Button
              variant="outline"
              onClick={() => handleCheckConnection()}
              disabled={checking || !apiUrl}
            >
              {checking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {connected
                ? "Connected"
                : "Not connected — make sure TinyAGI is running"}
            </span>
            {apiUrl !== (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777") && (
              <button
                onClick={handleResetUrl}
                className="text-xs text-muted-foreground hover:text-primary"
              >
                Reset to default
              </button>
            )}
          </div>

          {connected === false && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-sm space-y-2">
              <p className="font-medium text-destructive">Cannot reach the API server</p>
              <p className="text-muted-foreground">
                Make sure TinyAGI is installed and running:
              </p>
              <pre className="bg-muted rounded px-2 py-1 text-xs overflow-x-auto">
                npx tinyagi{"\n"}# or if already installed:{"\n"}tinyagi start --skip-setup
              </pre>
              <p className="text-muted-foreground text-xs">
                <a
                  href="https://github.com/TinyAGI/tinyagi#-quick-start"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Installation guide
                </a>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setup prompt — connected but no config */}
      {connected && needsSetup && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              <span className="font-medium">Setup Required</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Run <code className="text-xs">tinyagi channel setup</code> to configure channels, or edit settings below.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Full settings — connected and configured */}
      {connected && settings && !needsSetup && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <OverviewCard
              icon={<FolderOpen className="h-4 w-4 text-muted-foreground" />}
              title="Workspace"
              value={settings.workspace?.name || settings.workspace?.path || "Default"}
            />
            <OverviewCard
              icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
              title="Default Provider"
              value={settings.models?.provider || "anthropic"}
            />
            <OverviewCard
              icon={<Wifi className="h-4 w-4 text-muted-foreground" />}
              title="Channels"
              value={settings.channels?.enabled?.join(", ") || "None"}
            />
            <OverviewCard
              icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
              title="Heartbeat"
              value={settings.monitoring?.heartbeat_interval ? `${settings.monitoring.heartbeat_interval}s` : "Disabled"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                Configuration (settings.json)
                <Badge variant="outline" className="text-[10px]">JSON</Badge>
              </CardTitle>
              <CardDescription>
                Edit the raw configuration. Changes take effect on next message processing cycle.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                rows={30}
                className="font-mono text-xs leading-relaxed"
                spellCheck={false}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">API Endpoints</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <ApiEndpoint method="POST" path="/api/message" desc="Send a message to the queue" />
                <ApiEndpoint method="GET" path="/api/agents" desc="List all agents" />
                <ApiEndpoint method="GET" path="/api/teams" desc="List all teams" />
                <ApiEndpoint method="GET" path="/api/settings" desc="Get current settings" />
                <ApiEndpoint method="PUT" path="/api/settings" desc="Update settings" />
                <ApiEndpoint method="GET" path="/api/queue/status" desc="Queue status" />
                <ApiEndpoint method="GET" path="/api/responses" desc="Recent responses" />
                <ApiEndpoint method="GET" path="/api/events/stream" desc="SSE event stream" />
                <ApiEndpoint method="GET" path="/api/events" desc="Recent events (polling)" />
                <ApiEndpoint method="GET" path="/api/logs" desc="Queue processor logs" />
                <ApiEndpoint method="GET" path="/api/chats" desc="Chat histories" />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}



function OverviewCard({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
        </div>
        <p className="text-sm font-medium truncate">{value}</p>
      </CardContent>
    </Card>
  );
}

function ApiEndpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">{method}</span>
      <div>
        <code className="text-xs">{path}</code>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

