"use client";

import { useState, useCallback } from "react";
import { usePolling } from "@/lib/hooks";
import { getAgents, saveAgent, deleteAgent, type AgentConfig } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Cpu, FolderOpen, FileText, Plus, Pencil, Trash2,
  X, Check, Loader2,
} from "lucide-react";

type FormData = {
  id: string;
  name: string;
  provider: string;
  model: string;
  working_directory: string;
  system_prompt: string;
  prompt_file: string;
};

const emptyForm: FormData = {
  id: "", name: "", provider: "anthropic", model: "sonnet",
  working_directory: "", system_prompt: "", prompt_file: "",
};

export default function AgentsPage() {
  const { data: agents, loading, refresh } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const [editing, setEditing] = useState<FormData | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  const openNew = () => {
    setEditing({ ...emptyForm });
    setIsNew(true);
    setError("");
  };

  const openEdit = (id: string, agent: AgentConfig) => {
    setEditing({
      id,
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      working_directory: agent.working_directory,
      system_prompt: agent.system_prompt || "",
      prompt_file: agent.prompt_file || "",
    });
    setIsNew(false);
    setError("");
  };

  const cancel = () => { setEditing(null); setError(""); };

  const handleSave = useCallback(async () => {
    if (!editing) return;
    const { id, name, provider, model, working_directory, system_prompt, prompt_file } = editing;
    if (!id.trim() || !name.trim() || !provider.trim() || !model.trim()) {
      setError("ID, name, provider, and model are required");
      return;
    }
    if (/\s/.test(id)) {
      setError("ID cannot contain spaces");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveAgent(id.toLowerCase(), {
        name, provider, model, working_directory,
        ...(system_prompt ? { system_prompt } : {}),
        ...(prompt_file ? { prompt_file } : {}),
      });
      setEditing(null);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editing, refresh]);

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      await deleteAgent(id);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }, [refresh]);

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Agents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your AI agents
          </p>
        </div>
        <Button onClick={openNew} disabled={!!editing}>
          <Plus className="h-4 w-4" />
          Add Agent
        </Button>
      </div>

      {/* Editor */}
      {editing && (
        <AgentEditor
          form={editing}
          setForm={setEditing}
          isNew={isNew}
          saving={saving}
          error={error}
          onSave={handleSave}
          onCancel={cancel}
        />
      )}

      {/* Agent Grid */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          Loading agents...
        </div>
      ) : agents && Object.keys(agents).length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(agents).map(([id, agent]) => (
            <AgentCard
              key={id}
              id={id}
              agent={agent}
              onEdit={() => openEdit(id, agent)}
              onDelete={() => handleDelete(id)}
              deleting={deleting === id}
            />
          ))}
        </div>
      ) : !editing ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Bot className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No agents configured</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click &quot;Add Agent&quot; to create your first agent
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function AgentEditor({
  form, setForm, isNew, saving, error, onSave, onCancel,
}: {
  form: FormData;
  setForm: (f: FormData) => void;
  isNew: boolean;
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (field: keyof FormData, value: string) =>
    setForm({ ...form, [field]: value });

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          {isNew ? <Plus className="h-4 w-4 text-primary" /> : <Pencil className="h-4 w-4 text-primary" />}
          {isNew ? "New Agent" : `Edit @${form.id}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Agent ID</label>
            <Input
              value={form.id}
              onChange={(e) => set("id", e.target.value)}
              placeholder="e.g. coder"
              disabled={!isNew}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Display Name</label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Coder"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Provider</label>
            <Select value={form.provider} onChange={(e) => set("provider", e.target.value)}>
              <option value="anthropic">anthropic</option>
              <option value="openai">openai</option>
              <option value="opencode">opencode</option>
              <option value="avian">avian</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Model</label>
            <Input
              value={form.model}
              onChange={(e) => set("model", e.target.value)}
              placeholder="e.g. sonnet, opus, gpt-5.3-codex"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Working Directory</label>
            <Input
              value={form.working_directory}
              onChange={(e) => set("working_directory", e.target.value)}
              placeholder="Leave empty for default workspace path"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">System Prompt (optional)</label>
            <Textarea
              value={form.system_prompt}
              onChange={(e) => set("system_prompt", e.target.value)}
              placeholder="Custom system prompt for this agent..."
              rows={3}
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Prompt File (optional)</label>
            <Input
              value={form.prompt_file}
              onChange={(e) => set("prompt_file", e.target.value)}
              placeholder="Path to a prompt file"
              className="font-mono"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {isNew ? "Create Agent" : "Save Changes"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            <X className="h-4 w-4" />
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentCard({
  id, agent, onEdit, onDelete, deleting,
}: {
  id: string;
  agent: AgentConfig;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const providerColors: Record<string, string> = {
    anthropic: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    openai: "bg-green-500/10 text-green-600 dark:text-green-400",
    opencode: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    avian: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  };

  return (
    <Card className="transition-colors hover:border-primary/50">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center bg-primary/10 text-primary text-sm font-bold uppercase">
              {agent.name.slice(0, 2)}
            </div>
            <div>
              <CardTitle className="text-base">{agent.name}</CardTitle>
              <CardDescription>@{id}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit} className="h-8 w-8">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => { onDelete(); setConfirmDelete(false); }}
                  disabled={deleting}
                  className="h-8 text-xs"
                >
                  {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="h-8 text-xs">
                  No
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
          <Badge className={providerColors[agent.provider] || "bg-secondary text-secondary-foreground"}>
            {agent.provider}
          </Badge>
          <Badge variant="outline">{agent.model}</Badge>
        </div>

        {agent.working_directory && (
          <div className="flex items-start gap-2">
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
            <p className="text-xs text-muted-foreground font-mono break-all">
              {agent.working_directory}
            </p>
          </div>
        )}

        {agent.system_prompt && (
          <div className="flex items-start gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
            <p className="text-xs text-muted-foreground line-clamp-2">
              {agent.system_prompt}
            </p>
          </div>
        )}

        {agent.prompt_file && (
          <div className="flex items-start gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
            <p className="text-xs text-muted-foreground font-mono">
              {agent.prompt_file}
            </p>
          </div>
        )}

        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            Send messages with <code className="bg-muted px-1 py-0.5 font-mono">@{id}</code> prefix
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
