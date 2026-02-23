"use client";

import { useState, useEffect } from "react";
import { getSettings, updateSettings, type Settings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Settings as SettingsIcon,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wifi,
  MessageSquare,
  Cpu,
  FolderOpen,
} from "lucide-react";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rawJson, setRawJson] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setRawJson(JSON.stringify(s, null, 2));
      })
      .catch((err) => {
        setErrorMsg(err.message);
        setStatus("error");
      })
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-primary" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            View and edit TinyClaw configuration
          </p>
        </div>
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
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          Loading settings...
        </div>
      ) : (
        <>
          {settings && (
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
          )}

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
  const methodColor = method === "POST" ? "bg-blue-500/10 text-blue-500" :
    method === "PUT" ? "bg-orange-500/10 text-orange-500" :
    "bg-green-500/10 text-green-500";

  return (
    <div className="flex items-center gap-3 border p-3">
      <Badge className={`${methodColor} text-[10px] font-mono`}>{method}</Badge>
      <code className="text-xs font-mono flex-1">{path}</code>
      <span className="text-xs text-muted-foreground hidden lg:inline">{desc}</span>
    </div>
  );
}
