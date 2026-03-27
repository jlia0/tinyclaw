"use client";

import { useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { usePolling } from "@/lib/hooks";
import {
  getTasks,
  reorderTasks,
  sendMessage,
  createTask,
  getAgents,
  getTeams,
  getProjects,
  type Task,
  type TaskStatus,
  type AgentConfig,
  type TeamConfig,
  type Project,
} from "@/lib/api";
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanOverlay,
} from "@/components/ui/kanban";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Plus,
  LayoutGrid,
  List,
  Bot,
  Users,
} from "lucide-react";
import {
  TaskCard,
  TaskCardOverlay,
  CreateTaskModal,
  TaskDetailPanel,
} from "@/components/task";

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "text-muted-foreground" },
  { id: "todo", label: "Todo", color: "text-violet-400" },
  { id: "in_progress", label: "In Progress", color: "text-blue-400" },
  { id: "review", label: "Review", color: "text-orange-400" },
  { id: "done", label: "Done", color: "text-emerald-400" },
];

const STATUS_DOT: Record<string, string> = {
  backlog: "bg-muted-foreground",
  todo: "bg-violet-400",
  in_progress: "bg-blue-400",
  review: "bg-orange-400",
  done: "bg-emerald-400",
};

export default function TasksPage() {
  const searchParams = useSearchParams();
  const projectFilter = searchParams.get("project");

  const { data: allTasks, refresh } = usePolling<Task[]>(getTasks, 3000);
  const { data: agents } = usePolling<Record<string, AgentConfig>>(
    getAgents,
    0
  );
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const { data: projects } = usePolling<Project[]>(getProjects, 5000);

  const [view, setView] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");

  // Filter tasks by project
  const tasks = useMemo(() => {
    if (!allTasks) return [];
    if (!projectFilter) return allTasks;
    return allTasks.filter((t) => t.projectId === projectFilter);
  }, [allTasks, projectFilter]);

  const currentProject = projectFilter
    ? projects?.find((p) => p.id === projectFilter)
    : null;

  const columns = useMemo(() => {
    const cols: Record<UniqueIdentifier, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const task of tasks) {
      const col = cols[task.status];
      if (col) col.push(task);
    }
    return cols;
  }, [tasks]);

  const handleValueChange = useCallback(
    async (newColumns: Record<UniqueIdentifier, Task[]>) => {
      // When filtering by project, we need to preserve non-visible tasks
      const colMap: Record<string, string[]> = {};
      if (projectFilter && allTasks) {
        // Start with existing order of non-filtered tasks
        for (const col of COLUMNS) {
          const nonFiltered = allTasks
            .filter((t) => t.status === col.id && t.projectId !== projectFilter)
            .map((t) => t.id);
          const filtered = (newColumns[col.id] ?? []).map((t) => t.id);
          colMap[col.id] = [...filtered, ...nonFiltered];
        }
      } else {
        for (const [status, items] of Object.entries(newColumns)) {
          colMap[status] = items.map((t) => t.id);
        }
      }

      const prevInProgress = new Set(
        (columns.in_progress ?? []).map((t) => t.id)
      );
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
    [refresh, columns, projectFilter, allTasks]
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

  const handleQuickCreate = useCallback(async () => {
    if (!quickTitle.trim()) return;
    try {
      await createTask({
        title: quickTitle.trim(),
        status: "backlog",
        projectId: projectFilter || undefined,
      });
      setQuickTitle("");
      refresh();
    } catch {
      // Ignore
    }
  }, [quickTitle, projectFilter, refresh]);

  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTaskId(task.id);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
            {currentProject ? (
              <>
                <div
                  className="h-4 w-4 rounded-sm shrink-0"
                  style={{ backgroundColor: currentProject.color }}
                />
                {currentProject.name}
              </>
            ) : (
              "All Tasks"
            )}
          </h1>
          {currentProject?.description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {currentProject.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center border rounded-md">
            <Button
              variant={view === "board" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 rounded-r-none"
              onClick={() => setView("board")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 rounded-l-none"
              onClick={() => setView("list")}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            disabled={creating}
          >
            <Plus className="h-3.5 w-3.5" />
            New Task
          </Button>
        </div>
      </div>

      {/* Quick create */}
      <div className="px-6 py-2 border-b">
        <div className="flex gap-2">
          <Input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="Quick create task..."
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleQuickCreate();
            }}
          />
          {quickTitle.trim() && (
            <Button size="sm" className="h-8" onClick={handleQuickCreate}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Create modal */}
      {creating && (
        <CreateTaskModal
          agents={agents || {}}
          teams={teams || {}}
          projects={projects || []}
          defaultProjectId={projectFilter || undefined}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      )}

      {/* Detail panel */}
      {selectedTaskId && (
        <TaskDetailPanel
          taskId={selectedTaskId}
          agents={agents || {}}
          teams={teams || {}}
          projects={projects || []}
          onClose={() => setSelectedTaskId(null)}
          onChanged={refresh}
        />
      )}

      {/* Board view */}
      {view === "board" && (
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
                    <span
                      className={`text-xs font-semibold uppercase tracking-wider ${col.color}`}
                    >
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
                        onEdit={handleTaskClick}
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
      )}

      {/* List view */}
      {view === "list" && (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card border-b">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium w-8"></th>
                <th className="px-4 py-2 font-medium w-20">ID</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium w-28">Status</th>
                <th className="px-4 py-2 font-medium w-36">Assignee</th>
                {!projectFilter && (
                  <th className="px-4 py-2 font-medium w-36">Project</th>
                )}
                <th className="px-4 py-2 font-medium w-24">Created</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const project = task.projectId
                  ? projects?.find((p) => p.id === task.projectId)
                  : null;
                const assigneeName = task.assignee
                  ? task.assigneeType === "team"
                    ? teams?.[task.assignee]?.name || task.assignee
                    : agents?.[task.assignee]?.name || task.assignee
                  : null;

                return (
                  <tr
                    key={task.id}
                    className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <td className="px-4 py-2">
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[task.status]}`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className="text-[11px] font-mono font-semibold"
                        style={{ color: project?.color }}
                      >
                        {task.identifier}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <p className="font-medium">{task.title}</p>
                      {task.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {task.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        variant="secondary"
                        className="text-[10px] capitalize"
                      >
                        {task.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {assigneeName ? (
                        <span className="flex items-center gap-1 text-xs">
                          {task.assigneeType === "team" ? (
                            <Users className="h-3 w-3" />
                          ) : (
                            <Bot className="h-3 w-3" />
                          )}
                          {assigneeName}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">
                          —
                        </span>
                      )}
                    </td>
                    {!projectFilter && (
                      <td className="px-4 py-2">
                        {project ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <div
                              className="h-2.5 w-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: project.color }}
                            />
                            {project.name}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(task.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
              {tasks.length === 0 && (
                <tr>
                  <td
                    colSpan={projectFilter ? 6 : 7}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    No tasks yet. Create one to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
