"use client";

import { useState, useCallback, useMemo } from "react";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { usePolling } from "@/lib/hooks";
import {
  getTasks, createTask, updateTask, deleteTask, reorderTasks, sendMessage,
  getAgents, getTeams, getProjects,
  type Task, type TaskStatus, type AgentConfig, type TeamConfig, type Project,
} from "@/lib/api";
import {
  Kanban, KanbanBoard, KanbanColumn, KanbanItem, KanbanItemHandle, KanbanOverlay,
} from "@/components/ui/kanban";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardList, Plus, GripVertical, Bot, Users, X, Check, Loader2,
  Trash2, Send, Clock, FolderKanban, Pencil,
} from "lucide-react";

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "text-muted-foreground" },
  { id: "in_progress", label: "In Progress", color: "text-blue-400" },
  { id: "review", label: "Review", color: "text-orange-400" },
  { id: "done", label: "Done", color: "text-emerald-400" },
];

interface TaskForm {
  title: string;
  description: string;
  assignee: string;
  assigneeType: "agent" | "team" | "";
  projectId: string;
}

const emptyForm: TaskForm = { title: "", description: "", assignee: "", assigneeType: "", projectId: "" };

export default function TasksPage() {
  const { data: tasks, refresh } = usePolling<Task[]>(getTasks, 3000);
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const { data: projects } = usePolling<Project[]>(getProjects, 5000);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TaskForm>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState<TaskForm>({ ...emptyForm });

  // Build kanban value: columns → task items
  const columns = useMemo(() => {
    const cols: Record<UniqueIdentifier, Task[]> = {
      backlog: [],
      in_progress: [],
      review: [],
      done: [],
    };
    if (tasks) {
      for (const task of tasks) {
        const col = cols[task.status];
        if (col) col.push(task);
      }
    }
    return cols;
  }, [tasks]);

  const handleValueChange = useCallback(
    async (newColumns: Record<UniqueIdentifier, Task[]>) => {
      // Build columns map of status → task IDs for bulk reorder
      const colMap: Record<string, string[]> = {};
      for (const [status, items] of Object.entries(newColumns)) {
        colMap[status] = items.map((t) => t.id);
      }

      // Detect tasks newly moved into "in_progress" that have an assignee
      const prevInProgress = new Set((columns.in_progress ?? []).map((t) => t.id));
      const newlyInProgress = (newColumns.in_progress ?? []).filter(
        (t) => !prevInProgress.has(t.id) && t.assignee
      );

      try {
        // Send messages before updating status so tasks only move to
        // in_progress once the agent has actually been notified.
        for (const task of newlyInProgress) {
          const msg = `@${task.assignee} ${task.title}${task.description ? "\n\n" + task.description : ""}\n\n[task:${task.id}]`;
          await sendMessage({ message: msg, sender: "Web", channel: "web" });
        }
        await reorderTasks(colMap);
        refresh();
      } catch {
        // Ignore — will refresh on next poll
      }
    },
    [refresh, columns]
  );

  const handleCreate = useCallback(async () => {
    if (!form.title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createTask({
        title: form.title.trim(),
        description: form.description.trim(),
        assignee: form.assignee,
        assigneeType: form.assigneeType,
        status: "backlog",
        ...(form.projectId ? { projectId: form.projectId } : {}),
      });
      setForm({ ...emptyForm });
      setCreating(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [form, refresh]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteTask(id);
        refresh();
      } catch {
        // Ignore
      }
    },
    [refresh]
  );

  const handleAssign = useCallback(
    async (task: Task) => {
      if (!task.assignee) return;
      const prefix = task.assigneeType === "team" ? "@" : "@";
      const msg = `${prefix}${task.assignee} ${task.title}${task.description ? "\n\n" + task.description : ""}\n\n[task:${task.id}]`;
      try {
        await sendMessage({ message: msg, sender: "Web", channel: "web" });
        await updateTask(task.id, { status: "in_progress" });
        refresh();
      } catch {
        // Ignore
      }
    },
    [refresh]
  );

  const openEdit = useCallback((task: Task) => {
    setEditingTask(task);
    setEditForm({
      title: task.title,
      description: task.description,
      assignee: task.assignee || "",
      assigneeType: task.assigneeType || "",
      projectId: task.projectId || "",
    });
  }, []);

  const closeEdit = useCallback(() => {
    setEditingTask(null);
    setEditForm({ ...emptyForm });
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingTask) return;
    if (!editForm.title.trim()) {
      setError("Title is required");
      return;
    }
    const assignee = editForm.assignee ? editForm.assignee : "";
    const assigneeType = editForm.assignee ? editForm.assigneeType : "";
    setSaving(true);
    setError("");
    try {
      await updateTask(editingTask.id, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        assignee,
        assigneeType,
        projectId: editForm.projectId || undefined,
      });
      closeEdit();
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editingTask, editForm, refresh, closeEdit]);

  const setAssignee = (value: string) => {
    if (!value) {
      setForm((f) => ({ ...f, assignee: "", assigneeType: "" }));
      return;
    }
    const [type, id] = value.split(":");
    setForm((f) => ({
      ...f,
      assignee: id,
      assigneeType: type as "agent" | "team",
    }));
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Tasks
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Assign and track work across agents
          </p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={creating}>
          <Plus className="h-4 w-4" />
          New Task
        </Button>
      </div>

      {/* New task modal */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <Card className="w-full max-w-lg border-border">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">New Task</p>
                  <p className="text-xs text-muted-foreground">Create and assign work</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setCreating(false);
                    setForm({ ...emptyForm });
                    setError("");
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Task title"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="text-sm resize-none"
                  placeholder="Description (optional)"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Assignee</label>
                  <Select
                    value={form.assignee ? `${form.assigneeType}:${form.assignee}` : ""}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {agents &&
                      Object.entries(agents).map(([id, a]) => (
                        <option key={`agent:${id}`} value={`agent:${id}`}>
                          Agent: {a.name}
                        </option>
                      ))}
                    {teams &&
                      Object.entries(teams).map(([id, t]) => (
                        <option key={`team:${id}`} value={`team:${id}`}>
                          Team: {t.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Project</label>
                  <Select
                    value={form.projectId}
                    onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
                  >
                    <option value="">No project</option>
                    {projects?.filter((p) => p.status === "active").map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex items-center gap-2">
                <Button onClick={handleCreate} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Create
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCreating(false);
                    setForm({ ...emptyForm });
                    setError("");
                  }}
                  disabled={saving}
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit task modal */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <Card className="w-full max-w-lg border-border">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Edit Task</p>
                  <p className="text-xs text-muted-foreground">{editingTask.title}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={closeEdit}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <Input
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <Textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="text-sm resize-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Assignee</label>
                  <Select
                    value={editForm.assignee ? `${editForm.assigneeType}:${editForm.assignee}` : ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) {
                        setEditForm((f) => ({ ...f, assignee: "", assigneeType: "" }));
                        return;
                      }
                      const [type, id] = value.split(":");
                      setEditForm((f) => ({
                        ...f,
                        assignee: id,
                        assigneeType: type as "agent" | "team",
                      }));
                    }}
                  >
                    <option value="">Unassigned</option>
                    {agents &&
                      Object.entries(agents).map(([id, a]) => (
                        <option key={`agent:${id}`} value={`agent:${id}`}>
                          Agent: {a.name}
                        </option>
                      ))}
                    {teams &&
                      Object.entries(teams).map(([id, t]) => (
                        <option key={`team:${id}`} value={`team:${id}`}>
                          Team: {t.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Project</label>
                  <Select
                    value={editForm.projectId}
                    onChange={(e) => setEditForm((f) => ({ ...f, projectId: e.target.value }))}
                  >
                    <option value="">No Project</option>
                    {(projects || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex items-center gap-2">
                <Button onClick={handleEditSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save
                </Button>
                <Button variant="ghost" onClick={closeEdit} disabled={saving}>
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto p-4">
        <Kanban
          value={columns}
          onValueChange={handleValueChange}
          getItemValue={(item: Task) => item.id}
        >
          <KanbanBoard className="h-full">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                value={col.id}
                className="min-w-[260px] max-w-[320px] flex-1 bg-card border border-border"
              >
                <div className="flex items-center justify-between px-2 py-1">
                  <span className={`text-xs font-semibold uppercase tracking-wider ${col.color}`}>
                    {col.label}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {(columns[col.id] ?? []).length}
                  </Badge>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto px-0.5">
                  {(columns[col.id] ?? []).map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      agents={agents || {}}
                      teams={teams || {}}
                      projects={projects || []}
                      onDelete={handleDelete}
                      onAssign={handleAssign}
                      onEdit={openEdit}
                    />
                  ))}
                </div>
              </KanbanColumn>
            ))}
          </KanbanBoard>

          <KanbanOverlay>
            {({ value, variant }) => {
              if (variant === "column") return null;
              const task = tasks?.find((t) => t.id === value);
              if (!task) return null;
              return (
                <TaskCardOverlay
                  task={task}
                  agents={agents || {}}
                  teams={teams || {}}
                />
              );
            }}
          </KanbanOverlay>
        </Kanban>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  agents,
  teams,
  projects,
  onDelete,
  onAssign,
  onEdit,
}: {
  task: Task;
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  projects: Project[];
  onDelete: (id: string) => void;
  onAssign: (task: Task) => void;
  onEdit: (task: Task) => void;
}) {
  const project = task.projectId ? projects.find((p) => p.id === task.projectId) : null;
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <KanbanItem value={task.id} asHandle={false}>
      <Card className="border-border hover:border-primary/30 transition-colors">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start gap-2">
            <KanbanItemHandle className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground">
              <GripVertical className="h-3.5 w-3.5" />
            </KanbanItemHandle>
            <p className="text-sm font-medium flex-1 leading-tight">{task.title}</p>
          </div>

          {task.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 pl-5.5">
              {task.description}
            </p>
          )}

          <div className="flex items-center justify-between pl-5.5">
            <div className="flex items-center gap-1.5">
              {project && (
                <Badge variant="outline" className="text-[10px] flex items-center gap-1">
                  <FolderKanban className="h-2.5 w-2.5" />
                  {project.name}
                </Badge>
              )}
              {task.assignee ? (
                <Badge
                  variant="secondary"
                  className="text-[10px] flex items-center gap-1"
                >
                  {task.assigneeType === "team" ? (
                    <Users className="h-2.5 w-2.5" />
                  ) : (
                    <Bot className="h-2.5 w-2.5" />
                  )}
                  {task.assigneeType === "team"
                    ? teams[task.assignee]?.name || task.assignee
                    : agents[task.assignee]?.name || task.assignee}
                </Badge>
              ) : (
                <span className="text-[10px] text-muted-foreground/60">Unassigned</span>
              )}
            </div>

            <div className="flex items-center gap-0.5">
              {task.assignee && task.status === "backlog" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssign(task);
                  }}
                  title="Send to agent"
                >
                  <Send className="h-3 w-3" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task);
                }}
                title="Edit task"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              {confirmDelete ? (
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(task.id);
                      setConfirmDelete(false);
                    }}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(false);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(true);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 pl-5.5">
            <Clock className="h-2.5 w-2.5 text-muted-foreground/50" />
            <span className="text-[9px] text-muted-foreground/50">
              {new Date(task.createdAt).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </KanbanItem>
  );
}

function TaskCardOverlay({
  task,
  agents,
  teams,
}: {
  task: Task;
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
}) {
  return (
    <Card className="border-primary/50 shadow-lg w-[280px]">
      <CardContent className="p-3 space-y-1">
        <p className="text-sm font-medium">{task.title}</p>
        {task.assignee && (
          <Badge variant="secondary" className="text-[10px] flex items-center gap-1 w-fit">
            {task.assigneeType === "team" ? (
              <Users className="h-2.5 w-2.5" />
            ) : (
              <Bot className="h-2.5 w-2.5" />
            )}
            {task.assigneeType === "team"
              ? teams[task.assignee]?.name || task.assignee
              : agents[task.assignee]?.name || task.assignee}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
