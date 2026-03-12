"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { runSetup, type Settings, type AgentConfig } from "@/lib/api";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Wand2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
} from "lucide-react";

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)", hint: "recommended" },
  { value: "openai", label: "OpenAI (Codex/GPT)" },
  { value: "opencode", label: "OpenCode" },
] as const;

const MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
  ],
  openai: [
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "gpt-5.2", label: "GPT-5.2" },
  ],
  opencode: [
    { value: "opencode/claude-sonnet-4-5", label: "opencode/claude-sonnet-4-5" },
    { value: "opencode/claude-opus-4-6", label: "opencode/claude-opus-4-6" },
    { value: "opencode/gemini-3-flash", label: "opencode/gemini-3-flash" },
    { value: "opencode/gemini-3-pro", label: "opencode/gemini-3-pro" },
  ],
};

const CHANNELS = [
  { id: "discord", label: "Discord", needsToken: true, tokenHint: "Bot token from discord.com/developers" },
  { id: "telegram", label: "Telegram", needsToken: true, tokenHint: "Token from @BotFather" },
  { id: "whatsapp", label: "WhatsApp", needsToken: false, tokenHint: "" },
] as const;

const STEPS = ["Channels", "Provider", "Workspace", "Agents", "Review"] as const;

interface SetupAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
}

function cleanId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function getDuplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return Array.from(duplicates);
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [enabledChannels, setEnabledChannels] = useState<string[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("sonnet");
  const [heartbeat, setHeartbeat] = useState("3600");
  const [workspaceName, setWorkspaceName] = useState("tinyclaw-workspace");
  const [agents, setAgents] = useState<SetupAgent[]>([
    { id: "assistant", name: "Assistant", provider: "anthropic", model: "sonnet" },
  ]);

  const missingTokenChannels = CHANNELS
    .filter((ch) => ch.needsToken && enabledChannels.includes(ch.id))
    .filter((ch) => !tokens[ch.id]?.trim());

  const resolvedAgentIds = agents.map((agent) => cleanId(agent.id) || "assistant");
  const duplicateAgentIds = getDuplicateIds(resolvedAgentIds);

  const canNext = (): boolean => {
    switch (step) {
      case 0:
        return enabledChannels.length > 0 && missingTokenChannels.length === 0;
      case 1:
        return !!provider && !!model;
      case 2:
        return !!workspaceName.trim();
      case 3:
        return agents.length > 0
          && agents.every((a) => a.id && a.name)
          && duplicateAgentIds.length === 0;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const toggleChannel = (ch: string) => {
    setEnabledChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  };

  const updateAgent = (idx: number, patch: Partial<SetupAgent>) => {
    setAgents((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  const removeAgent = (idx: number) => {
    setAgents((prev) => prev.filter((_, i) => i !== idx));
  };

  const addAgent = () => {
    setAgents((prev) => [...prev, { id: "", name: "", provider, model }]);
  };

  const handleProviderChange = (p: string) => {
    setProvider(p);
    const models = MODELS[p];
    if (models?.length) setModel(models[0].value);
  };

  const buildSettings = (): Settings => {
    if (missingTokenChannels.length > 0) {
      throw new Error(`Missing tokens for: ${missingTokenChannels.map((c) => c.label).join(", ")}`);
    }
    if (duplicateAgentIds.length > 0) {
      throw new Error(`Duplicate agent IDs: ${duplicateAgentIds.join(", ")}`);
    }

    const sanitizedName = workspaceName.replace(/ /g, "-").replace(/[^a-zA-Z0-9_/~.-]/g, "");
    const workspacePath = sanitizedName.startsWith("/") || sanitizedName.startsWith("~")
      ? sanitizedName
      : `~/` + sanitizedName;

    const agentsMap: Record<string, AgentConfig> = {};
    for (const a of agents) {
      const id = cleanId(a.id) || "assistant";
      agentsMap[id] = {
        name: a.name || id,
        provider: a.provider,
        model: a.model,
        working_directory: `${workspacePath}/${id}`,
      };
    }

    return {
      workspace: { path: workspacePath, name: sanitizedName },
      channels: {
        enabled: enabledChannels,
        discord: { bot_token: tokens["discord"] || "" },
        telegram: { bot_token: tokens["telegram"] || "" },
        whatsapp: {},
      },
      agents: agentsMap,
      models: {
        provider,
        ...(provider === "anthropic" ? { anthropic: { model } } : {}),
        ...(provider === "openai" ? { openai: { model } } : {}),
        ...(provider === "opencode" ? { opencode: { model } } : {}),
      },
      monitoring: { heartbeat_interval: parseInt(heartbeat) || 3600 },
    };
  };

  const handleFinish = async () => {
    try {
      setSaving(true);
      setError("");
      const settings = buildSettings();
      await runSetup(settings);
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-primary" />
          Setup
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure TinyClaw in a few steps
        </p>
      </div>

      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <button
              onClick={() => i < step && setStep(i)}
              className={`text-xs px-2 py-1 transition-colors ${
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                  ? "bg-accent text-accent-foreground cursor-pointer"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {label}
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {step === 0 && (
            <>
              <CardTitle className="text-sm">Messaging Channels</CardTitle>
              <CardDescription>Select which channels to enable.</CardDescription>
              <div className="space-y-3 pt-2">
                {CHANNELS.map((ch) => (
                  <div key={ch.id} className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enabledChannels.includes(ch.id)}
                        onChange={() => toggleChannel(ch.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-sm font-medium">{ch.label}</span>
                      {ch.needsToken && <Badge variant="outline" className="text-[10px]">Token required</Badge>}
                    </label>
                    {ch.needsToken && enabledChannels.includes(ch.id) && (
                      <div className="ml-7">
                        <Input
                          type="password"
                          placeholder={ch.tokenHint}
                          value={tokens[ch.id] || ""}
                          onChange={(e) => setTokens((prev) => ({ ...prev, [ch.id]: e.target.value }))}
                          className="text-xs"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {enabledChannels.length > 0 && missingTokenChannels.length > 0 && (
                <div className="text-xs text-destructive">
                  Enter tokens for: {missingTokenChannels.map((c) => c.label).join(", ")}.
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <CardTitle className="text-sm">AI Provider & Model</CardTitle>
              <CardDescription>Choose the default provider and model for agents.</CardDescription>
              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider</label>
                  <Select value={provider} onChange={(e) => handleProviderChange(e.target.value)} className="mt-1">
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Model</label>
                  <Select value={model} onChange={(e) => setModel(e.target.value)} className="mt-1">
                    {(MODELS[provider] || []).map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Heartbeat Interval (seconds)</label>
                  <Input
                    type="number"
                    value={heartbeat}
                    onChange={(e) => setHeartbeat(e.target.value)}
                    placeholder="3600"
                    className="mt-1"
                  />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <CardTitle className="text-sm">Workspace</CardTitle>
              <CardDescription>Where agent working directories will be created.</CardDescription>
              <div className="pt-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Workspace name or path</label>
                <Input
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="tinyclaw-workspace"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Relative names are created under ~/. Use an absolute path to place it elsewhere.
                </p>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <CardTitle className="text-sm">Agents</CardTitle>
              <CardDescription>Configure your agents. Each gets its own workspace directory.</CardDescription>
              <p className="text-xs text-muted-foreground">
                Tip: you can create more agents later by asking your agent. One is enough to start.
              </p>
              <div className="space-y-4 pt-2">
                {agents.map((agent, idx) => (
                  <div key={idx} className="border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Agent {idx + 1}</span>
                      {agents.length > 1 && (
                        <button onClick={() => removeAgent(idx)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase">ID</label>
                        <Input
                          value={agent.id}
                          onChange={(e) => updateAgent(idx, { id: cleanId(e.target.value) })}
                          placeholder="assistant"
                          className="text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase">Display Name</label>
                        <Input
                          value={agent.name}
                          onChange={(e) => updateAgent(idx, { name: e.target.value })}
                          placeholder="Assistant"
                          className="text-xs"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase">Provider</label>
                        <Select
                          value={agent.provider}
                          onChange={(e) => {
                            const p = e.target.value;
                            const m = MODELS[p]?.[0]?.value || "";
                            updateAgent(idx, { provider: p, model: m });
                          }}
                          className="text-xs"
                        >
                          {PROVIDERS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase">Model</label>
                        <Select
                          value={agent.model}
                          onChange={(e) => updateAgent(idx, { model: e.target.value })}
                          className="text-xs"
                        >
                          {(MODELS[agent.provider] || []).map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}
                {duplicateAgentIds.length > 0 && (
                  <div className="text-xs text-destructive">
                    Duplicate agent IDs: {duplicateAgentIds.join(", ")}.
                  </div>
                )}
                <Button variant="outline" onClick={addAgent} className="w-full">
                  <Plus className="h-4 w-4" />
                  Add Agent
                </Button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <CardTitle className="text-sm">Review</CardTitle>
              <CardDescription>Confirm your configuration before saving.</CardDescription>
              <div className="pt-2 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <ReviewItem label="Channels" value={enabledChannels.length > 0 ? enabledChannels.join(", ") : "None"} />
                  <ReviewItem label="Provider" value={provider} />
                  <ReviewItem label="Model" value={model} />
                  <ReviewItem label="Heartbeat" value={`${heartbeat}s`} />
                  <ReviewItem label="Workspace" value={workspaceName} />
                  <ReviewItem label="Agents" value={agents.map((a) => a.id || "(unnamed)").join(", ")} />
                </div>
                <Textarea
                  value={JSON.stringify(buildSettings(), null, 2)}
                  readOnly
                  rows={16}
                  className="font-mono text-xs leading-relaxed mt-3"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>

        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext()}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Finish Setup
          </Button>
        )}
      </div>

      {!error && !saving && (
        <div className="text-xs text-muted-foreground">
          Already set up?{" "}
          <Link href="/settings" className="text-primary hover:underline">
            Go to settings
          </Link>
          .
        </div>
      )}
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
