"use client";

import { useState, useCallback, useMemo } from "react";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { usePolling } from "@/lib/hooks";
import {
  getTasks, reorderTasks, sendMessage,
  getAgents, getTeams, getProjects,
  type Task, type TaskStatus, type AgentConfig, type TeamConfig, type Project,
} from "@/lib/api";
import {
  Kanban, KanbanBoard, KanbanColumn, KanbanOverlay,
} from "@/components/ui/kanban";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Plus } from "lucide-react";
import {
  TaskCard,
  TaskCardOverlay,
  CreateTaskModal,
  EditTaskModal,
} from "@/components/task";

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "text-muted-foreground" },
  { id: "in_progress", label: "In Progress", color: "text-blue-400" },
  { id: "review", label: "Review", color: "text-orange-400" },
  { id: "done", label: "Done", color: "text-emerald-400" },
];

export default function TasksPage() {
  const { data: tasks, refresh } = usePolling<Task[]>(getTasks, 3000);
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const { data: projects } = usePolling<Project[]>(getProjects, 5000);

  const [creating, setCreating] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const columns = useMemo(() => {
    const cols: Record<UniqueIdentifier, Task[]> = {
      backlog: [], in_progress: [], review: [], done: [],
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
      const colMap: Record<string, string[]> = {};
      for (const [status, items] of Object.entries(newColumns)) {
        colMap[status] = items.map((t) => t.id);
      }

      const prevInProgress = new Set((columns.in_progress ?? []).map((t) => t.id));
      const newlyInProgress = (newColumns.in_progress ?? []).filter(
        (t) => !prevInProgress.has(t.id) && t.assignee
      );

      try {
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

  const handleDelete = useCallback(
    async (id: string) => {
      const { deleteTask } = await import("@/lib/api");
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
      const { sendMessage: send, updateTask } = await import("@/lib/api");
      const msg = `@${task.assignee} ${task.title}${task.description ? "\n\n" + task.description : ""}\n\n[task:${task.id}]`;
      try {
        await send({ message: msg, sender: "Web", channel: "web" });
        await updateTask(task.id, { status: "in_progress" });
        refresh();
      } catch {
        // Ignore
      }
    },
    [refresh]
  );

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

      {/* Modals */}
      {creating && (
        <CreateTaskModal
          agents={agents || {}}
          teams={teams || {}}
          projects={projects || []}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      )}
      {editingTask && (
        <EditTaskModal
          task={editingTask}
          agents={agents || {}}
          teams={teams || {}}
          projects={projects || []}
          onClose={() => setEditingTask(null)}
          onSaved={refresh}
        />
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
                      onEdit={setEditingTask}
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
