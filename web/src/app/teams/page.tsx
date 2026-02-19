"use client";

import { useState, useCallback } from "react";
import { usePolling } from "@/lib/hooks";
import {
  getAgents, getTeams, saveTeam, deleteTeam,
  type AgentConfig, type TeamConfig,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users, Crown, Bot, ArrowRight, Plus, Pencil, Trash2,
  X, Check, Loader2,
} from "lucide-react";

type FormData = {
  id: string;
  name: string;
  agents: string[];
  leader_agent: string;
};

const emptyForm: FormData = {
  id: "", name: "", agents: [], leader_agent: "",
};

export default function TeamsPage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams, loading, refresh } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
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

  const openEdit = (id: string, team: TeamConfig) => {
    setEditing({
      id,
      name: team.name,
      agents: [...team.agents],
      leader_agent: team.leader_agent,
    });
    setIsNew(false);
    setError("");
  };

  const cancel = () => { setEditing(null); setError(""); };

  const handleSave = useCallback(async () => {
    if (!editing) return;
    const { id, name, agents: teamAgents, leader_agent } = editing;
    if (!id.trim() || !name.trim()) {
      setError("ID and name are required");
      return;
    }
    if (/\s/.test(id)) {
      setError("ID cannot contain spaces");
      return;
    }
    if (teamAgents.length === 0) {
      setError("At least one agent is required");
      return;
    }
    if (!leader_agent) {
      setError("A leader agent must be selected");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveTeam(id.toLowerCase(), { name, agents: teamAgents, leader_agent });
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
      await deleteTeam(id);
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
            <Users className="h-5 w-5 text-primary" />
            Teams
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Agent teams for collaborative task execution
          </p>
        </div>
        <Button onClick={openNew} disabled={!!editing}>
          <Plus className="h-4 w-4" />
          Add Team
        </Button>
      </div>

      {/* Editor */}
      {editing && (
        <TeamEditor
          form={editing}
          setForm={setEditing}
          isNew={isNew}
          saving={saving}
          error={error}
          onSave={handleSave}
          onCancel={cancel}
          availableAgents={agents || {}}
        />
      )}

      {/* Team List */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          Loading teams...
        </div>
      ) : teams && Object.keys(teams).length > 0 ? (
        <div className="space-y-4">
          {Object.entries(teams).map(([id, team]) => (
            <TeamCard
              key={id}
              id={id}
              team={team}
              agents={agents || {}}
              onEdit={() => openEdit(id, team)}
              onDelete={() => handleDelete(id)}
              deleting={deleting === id}
            />
          ))}
        </div>
      ) : !editing ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No teams configured</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click &quot;Add Team&quot; to create your first team
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">How Team Collaboration Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">1</div>
            <p>Messages sent to <code className="bg-muted px-1 py-0.5 font-mono">@team_id</code> are routed to the team leader agent.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">2</div>
            <p>The leader can delegate to teammates using <code className="bg-muted px-1 py-0.5 font-mono">[@teammate: message]</code> tags.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">3</div>
            <p>Teammates process in parallel and can mention each other for further collaboration.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">4</div>
            <p>When all branches resolve, responses are aggregated and sent back.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TeamEditor({
  form, setForm, isNew, saving, error, onSave, onCancel, availableAgents,
}: {
  form: FormData;
  setForm: (f: FormData) => void;
  isNew: boolean;
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
  availableAgents: Record<string, AgentConfig>;
}) {
  const agentIds = Object.keys(availableAgents);

  const toggleAgent = (agentId: string) => {
    const inTeam = form.agents.includes(agentId);
    let newAgents: string[];
    let newLeader = form.leader_agent;

    if (inTeam) {
      newAgents = form.agents.filter(a => a !== agentId);
      if (newLeader === agentId) {
        newLeader = newAgents[0] || "";
      }
    } else {
      newAgents = [...form.agents, agentId];
      if (!newLeader) newLeader = agentId;
    }

    setForm({ ...form, agents: newAgents, leader_agent: newLeader });
  };

  const setLeader = (agentId: string) => {
    setForm({ ...form, leader_agent: agentId });
  };

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          {isNew ? <Plus className="h-4 w-4 text-primary" /> : <Pencil className="h-4 w-4 text-primary" />}
          {isNew ? "New Team" : `Edit @${form.id}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Team ID</label>
            <Input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="e.g. backend-team"
              disabled={!isNew}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Display Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Backend Team"
            />
          </div>
        </div>

        {/* Agent Selection */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Team Members
            {form.agents.length > 0 && (
              <span className="ml-2 text-primary">{form.agents.length} selected</span>
            )}
          </label>
          {agentIds.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {agentIds.map(agentId => {
                const agent = availableAgents[agentId];
                const selected = form.agents.includes(agentId);
                const isLeader = form.leader_agent === agentId;
                return (
                  <div
                    key={agentId}
                    className={`flex items-center justify-between border px-3 py-2 cursor-pointer transition-colors ${
                      selected
                        ? isLeader
                          ? "border-primary bg-primary/10"
                          : "border-primary/50 bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                    onClick={() => toggleAgent(agentId)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Bot className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{agent.name}</p>
                        <p className="text-xs text-muted-foreground">@{agentId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {selected && (
                        <Button
                          variant={isLeader ? "default" : "ghost"}
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLeader(agentId);
                          }}
                        >
                          <Crown className="h-3 w-3" />
                          {isLeader ? "Leader" : "Set Leader"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No agents configured. Create agents first before building a team.
            </p>
          )}
        </div>

        {/* Selected order preview */}
        {form.agents.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Team Composition</label>
            <div className="flex items-center gap-2 flex-wrap">
              {form.agents.map((agentId, i) => {
                const agent = availableAgents[agentId];
                const isLeader = agentId === form.leader_agent;
                return (
                  <div key={agentId} className="flex items-center gap-2">
                    {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                    <Badge
                      variant={isLeader ? "default" : "outline"}
                      className="flex items-center gap-1"
                    >
                      {isLeader && <Crown className="h-3 w-3" />}
                      {agent?.name || agentId}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {isNew ? "Create Team" : "Save Changes"}
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

function TeamCard({
  id, team, agents, onEdit, onDelete, deleting,
}: {
  id: string;
  team: TeamConfig;
  agents: Record<string, AgentConfig>;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card className="transition-colors hover:border-primary/50">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{team.name}</CardTitle>
            <CardDescription>@{id}</CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="outline">
              {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
            </Badge>
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
      <CardContent>
        <div className="flex items-center gap-2 flex-wrap">
          {team.agents.map((agentId, i) => {
            const agent = agents[agentId];
            const isLeader = agentId === team.leader_agent;
            return (
              <div key={agentId} className="flex items-center gap-2">
                {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                <div
                  className={`flex items-center gap-2 border px-3 py-2 ${
                    isLeader ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <Bot className={`h-3.5 w-3.5 ${isLeader ? "text-primary" : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      {agent?.name || agentId}
                      {isLeader && (
                        <Crown className="h-3 w-3 text-primary" />
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      @{agentId}
                      {agent ? ` / ${agent.provider} / ${agent.model}` : null}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            Send messages with <code className="bg-muted px-1 py-0.5 font-mono">@{id}</code> prefix to start team collaboration
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
