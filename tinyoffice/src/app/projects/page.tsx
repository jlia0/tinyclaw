"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePolling } from "@/lib/hooks";
import {
  getAgents, getTeams, getProjects, getTasks,
  createProject, updateProject, deleteProject,
  type AgentConfig, type TeamConfig, type Project, type ProjectStatus, type Task,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  FolderKanban, Plus, Pencil, Trash2, X, Check, Loader2,
  Bot, Users, ClipboardList, ArrowRight,
} from "lucide-react";

const STATUS_OPTIONS: { value: ProjectStatus; label: string; color: string }[] = [
  { value: "active", label: "Active", color: "text-blue-400" },
  { value: "paused", label: "Paused", color: "text-yellow-400" },
  { value: "completed", label: "Completed", color: "text-emerald-400" },
  { value: "archived", label: "Archived", color: "text-muted-foreground" },
];

interface ProjectForm {
  isNew: boolean;
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  agents: string[];
  teams: string[];
}

export default function ProjectsPage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const { data: projects, refresh } = usePolling<Project[]>(getProjects, 2000);
  const { data: tasks } = usePolling<Task[]>(getTasks, 3000);

  const [editing, setEditing] = useState<ProjectForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Group tasks by projectId
  const tasksByProject = useMemo(() => {
    const map: Record<string, Task[]> = {};
    if (tasks) {
      for (const task of tasks) {
        if (task.projectId) {
          if (!map[task.projectId]) map[task.projectId] = [];
          map[task.projectId].push(task);
        }
      }
    }
    return map;
  }, [tasks]);

  const openNew = () => {
    setEditing({ isNew: true, id: "", name: "", description: "", status: "active", agents: [], teams: [] });
    setError("");
  };

  const openEdit = (project: Project) => {
    setEditing({
      isNew: false,
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      agents: [...project.agents],
      teams: [...project.teams],
    });
    setError("");
  };

  const cancel = () => { setEditing(null); setError(""); };

  const toggleAgent = (agentId: string) => {
    if (!editing) return;
    const has = editing.agents.includes(agentId);
    setEditing({
      ...editing,
      agents: has ? editing.agents.filter(a => a !== agentId) : [...editing.agents, agentId],
    });
  };

  const toggleTeam = (teamId: string) => {
    if (!editing) return;
    const has = editing.teams.includes(teamId);
    setEditing({
      ...editing,
      teams: has ? editing.teams.filter(t => t !== teamId) : [...editing.teams, teamId],
    });
  };

  const handleSave = useCallback(async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing.isNew) {
        await createProject({
          name: editing.name.trim(),
          description: editing.description.trim(),
          status: editing.status,
          agents: editing.agents,
          teams: editing.teams,
        });
      } else {
        await updateProject(editing.id, {
          name: editing.name.trim(),
          description: editing.description.trim(),
          status: editing.status,
          agents: editing.agents,
          teams: editing.teams,
        });
      }
      setEditing(null);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editing, refresh]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteProject(id);
      refresh();
    } catch { /* ignore */ }
  }, [refresh]);

  const agentEntries = agents ? Object.entries(agents) : [];
  const teamEntries = teams ? Object.entries(teams) : [];

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-primary" />
            Projects
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            High-level project management with agent assignments and task tracking
          </p>
        </div>
        <Button onClick={openNew} disabled={!!editing}>
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Editor */}
      {editing && (
        <Card className="border-primary/50">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              {editing.isNew ? <Plus className="h-4 w-4 text-primary" /> : <Pencil className="h-4 w-4 text-primary" />}
              {editing.isNew ? "New Project" : `Edit: ${editing.name}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Project Name</label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g. Backend Refactor"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select
                  value={editing.status}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value as ProjectStatus })}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Textarea
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                placeholder="What is this project about?"
                rows={2}
                className="text-sm resize-none"
              />
            </div>

            {/* Agent assignment */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Assigned Agents
                {editing.agents.length > 0 && (
                  <span className="ml-2 text-primary">{editing.agents.length} selected</span>
                )}
              </label>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {agentEntries.map(([id, agent]) => {
                  const selected = editing.agents.includes(id);
                  return (
                    <div
                      key={id}
                      className={`flex items-center gap-2 border px-3 py-2 cursor-pointer transition-colors ${
                        selected ? "border-primary/50 bg-primary/5" : "border-border hover:border-muted-foreground/50"
                      }`}
                      onClick={() => toggleAgent(id)}
                    >
                      <Bot className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{agent.name}</p>
                        <p className="text-[10px] text-muted-foreground">@{id}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Team assignment */}
            {teamEntries.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Assigned Teams
                  {editing.teams.length > 0 && (
                    <span className="ml-2 text-primary">{editing.teams.length} selected</span>
                  )}
                </label>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {teamEntries.map(([id, team]) => {
                    const selected = editing.teams.includes(id);
                    return (
                      <div
                        key={id}
                        className={`flex items-center gap-2 border px-3 py-2 cursor-pointer transition-colors ${
                          selected ? "border-primary/50 bg-primary/5" : "border-border hover:border-muted-foreground/50"
                        }`}
                        onClick={() => toggleTeam(id)}
                      >
                        <Users className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{team.name}</p>
                          <p className="text-[10px] text-muted-foreground">@{id} &middot; {team.agents.length} agents</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {editing.isNew ? "Create Project" : "Save Changes"}
              </Button>
              <Button variant="ghost" onClick={cancel} disabled={saving}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Project list */}
      {projects && projects.length > 0 ? (
        <div className="space-y-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              agents={agents || {}}
              teams={teams || {}}
              tasks={tasksByProject[project.id] || []}
              onEdit={() => openEdit(project)}
              onDelete={() => handleDelete(project.id)}
            />
          ))}
        </div>
      ) : !editing ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No projects yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a project to organize tasks and assign agents
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Info card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Projects &amp; Tasks</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">1</div>
            <p>Projects are high-level goals that group related tasks together. Think of them as epics or initiatives.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">2</div>
            <p>Assign agents and teams to a project. When creating tasks on the <Link href="/tasks" className="text-primary hover:underline">Tasks board</Link>, you can link them to a project.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">3</div>
            <p>Track progress at a glance: each project card shows task counts by status (backlog, in progress, review, done).</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectCard({
  project, agents, teams, tasks, onEdit, onDelete,
}: {
  project: Project;
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  tasks: Task[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const statusInfo = STATUS_OPTIONS.find(s => s.value === project.status) || STATUS_OPTIONS[0];

  // Task counts by status
  const taskCounts = { backlog: 0, in_progress: 0, review: 0, done: 0 };
  for (const task of tasks) {
    if (task.status in taskCounts) {
      taskCounts[task.status as keyof typeof taskCounts]++;
    }
  }
  const totalTasks = tasks.length;

  return (
    <Card className="transition-colors hover:border-primary/50">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <FolderKanban className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-base font-semibold">{project.name}</p>
                <Badge
                  variant={project.status === "active" ? "default" : "secondary"}
                  className={`text-[10px] ${statusInfo.color}`}
                >
                  {statusInfo.label}
                </Badge>
              </div>
              {project.description && (
                <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit} className="h-7 w-7">
              <Pencil className="h-3 w-3" />
            </Button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button variant="destructive" size="sm" onClick={() => { onDelete(); setConfirmDelete(false); }} className="h-7 text-xs">
                  Delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="h-7 text-xs">
                  No
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Assigned agents/teams */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {project.agents.map((agentId) => (
            <Badge key={agentId} variant="secondary" className="text-[10px] flex items-center gap-1">
              <Bot className="h-2.5 w-2.5" />
              {agents[agentId]?.name || agentId}
            </Badge>
          ))}
          {project.teams.map((teamId) => (
            <Badge key={teamId} variant="secondary" className="text-[10px] flex items-center gap-1">
              <Users className="h-2.5 w-2.5" />
              {teams[teamId]?.name || teamId}
            </Badge>
          ))}
          {project.agents.length === 0 && project.teams.length === 0 && (
            <span className="text-[10px] text-muted-foreground">No agents assigned</span>
          )}
        </div>

        {/* Task summary */}
        <div className="mt-4 pt-3 border-t">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">
                {totalTasks} task{totalTasks !== 1 ? "s" : ""}
              </span>
            </div>
            <Link
              href={`/tasks?project=${project.id}`}
              className="text-[10px] text-primary hover:underline flex items-center gap-1"
            >
              View in board <ArrowRight className="h-2.5 w-2.5" />
            </Link>
          </div>
          {totalTasks > 0 && (
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 bg-muted-foreground/40" />
                <span className="text-[10px] text-muted-foreground">Backlog {taskCounts.backlog}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 bg-blue-400" />
                <span className="text-[10px] text-muted-foreground">In Progress {taskCounts.in_progress}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 bg-orange-400" />
                <span className="text-[10px] text-muted-foreground">Review {taskCounts.review}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 bg-emerald-400" />
                <span className="text-[10px] text-muted-foreground">Done {taskCounts.done}</span>
              </div>
            </div>
          )}
          {totalTasks > 0 && (
            <div className="flex h-1.5 mt-2 overflow-hidden bg-muted">
              {taskCounts.done > 0 && (
                <div className="bg-emerald-400" style={{ width: `${(taskCounts.done / totalTasks) * 100}%` }} />
              )}
              {taskCounts.review > 0 && (
                <div className="bg-orange-400" style={{ width: `${(taskCounts.review / totalTasks) * 100}%` }} />
              )}
              {taskCounts.in_progress > 0 && (
                <div className="bg-blue-400" style={{ width: `${(taskCounts.in_progress / totalTasks) * 100}%` }} />
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
