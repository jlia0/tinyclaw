"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { usePolling, timeAgo } from "@/lib/hooks";
import {
  getTask,
  getComments,
  createComment,
  deleteComment,
  updateTask,
  deleteTask,
  sendMessage,
  type Task,
  type Comment,
  type AgentConfig,
  type TeamConfig,
  type Project,
} from "@/lib/api";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Send,
  Trash2,
  Bot,
  User,
  MessageSquare,
} from "lucide-react";

const STATUS_OPTIONS: { value: Task["status"]; label: string; color: string }[] = [
  { value: "backlog", label: "Backlog", color: "bg-muted text-muted-foreground" },
  { value: "todo", label: "Todo", color: "bg-violet-500/15 text-violet-400" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-500/15 text-blue-400" },
  { value: "review", label: "Review", color: "bg-orange-500/15 text-orange-400" },
  { value: "done", label: "Done", color: "bg-emerald-500/15 text-emerald-400" },
];

interface TaskDetailPanelProps {
  taskId: string;
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  projects: Project[];
  onClose: () => void;
  onChanged: () => void;
}

export function TaskDetailPanel({
  taskId,
  agents,
  teams,
  projects,
  onClose,
  onChanged,
}: TaskDetailPanelProps) {
  const { data: task, refresh: refreshTask } = usePolling<Task & { commentCount: number }>(
    () => getTask(taskId),
    5000,
    [taskId]
  );
  const { data: comments, refresh: refreshComments } = usePolling<Comment[]>(
    () => getComments(taskId),
    5000,
    [taskId]
  );

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (comments && commentsEndRef.current) {
      commentsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments?.length]);

  const handleUpdate = useCallback(
    async (data: Partial<Task>) => {
      await updateTask(taskId, data);
      refreshTask();
      onChanged();
    },
    [taskId, refreshTask, onChanged]
  );

  const handleStatusChange = useCallback(
    async (status: string) => {
      const prev = task?.status;
      await handleUpdate({ status: status as Task["status"] });
      // If moved to in_progress and has assignee, notify agent
      if (status === "in_progress" && prev !== "in_progress" && task?.assignee) {
        const msg = `@${task.assignee} ${task.title}${task.description ? "\n\n" + task.description : ""}\n\n[task:${task.id}]`;
        await sendMessage({ message: msg, sender: "Web", channel: "web" }).catch(() => {});
      }
    },
    [task, handleUpdate]
  );

  const handleAssigneeChange = useCallback(
    (value: string) => {
      if (value === "none") {
        handleUpdate({ assignee: "", assigneeType: "" });
      } else {
        const [type, id] = value.split(":");
        handleUpdate({ assignee: id, assigneeType: type as "agent" | "team" });
      }
    },
    [handleUpdate]
  );

  const handleProjectChange = useCallback(
    (value: string) => {
      handleUpdate({ projectId: value === "none" ? "" : value });
    },
    [handleUpdate]
  );

  const handleSaveTitle = useCallback(async () => {
    if (titleDraft.trim() && titleDraft.trim() !== task?.title) {
      await handleUpdate({ title: titleDraft.trim() });
    }
    setEditingTitle(false);
  }, [titleDraft, task, handleUpdate]);

  const handleSaveDesc = useCallback(async () => {
    if (descDraft !== task?.description) {
      await handleUpdate({ description: descDraft });
    }
    setEditingDesc(false);
  }, [descDraft, task, handleUpdate]);

  const handleAddComment = useCallback(async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    try {
      await createComment(taskId, {
        author: "User",
        authorType: "user",
        content: commentText.trim(),
      });
      setCommentText("");
      refreshComments();
    } finally {
      setSubmitting(false);
    }
  }, [taskId, commentText, refreshComments]);

  const handleDeleteComment = useCallback(
    async (id: string) => {
      await deleteComment(id);
      refreshComments();
    },
    [refreshComments]
  );

  const handleDeleteTask = useCallback(async () => {
    await deleteTask(taskId);
    onChanged();
    onClose();
  }, [taskId, onChanged, onClose]);

  if (!task) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l bg-card shadow-xl flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const assigneeValue = task.assignee
    ? `${task.assigneeType}:${task.assignee}`
    : "none";
  const statusInfo = STATUS_OPTIONS.find((s) => s.value === task.status)!;
  const taskProject = task.projectId
    ? projects.find((p) => p.id === task.projectId)
    : null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg border-l bg-card shadow-xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Badge className={`${statusInfo.color} text-[10px] shrink-0`}>
              {statusInfo.label}
            </Badge>
            <span
              className="text-xs font-mono font-medium"
              style={{ color: taskProject?.color }}
            >
              {task.identifier}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={handleDeleteTask}
              title="Delete task"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-5">
            {/* Title */}
            {editingTitle ? (
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                autoFocus
                className="text-lg font-semibold"
              />
            ) : (
              <h2
                className="text-lg font-semibold cursor-pointer hover:text-primary transition-colors"
                onClick={() => {
                  setTitleDraft(task.title);
                  setEditingTitle(true);
                }}
              >
                {task.title}
              </h2>
            )}

            {/* Metadata fields */}
            <div className="grid grid-cols-[100px_1fr] gap-y-3 gap-x-3 text-sm">
              <span className="text-muted-foreground">Status</span>
              <Select value={task.status} onValueChange={handleStatusChange}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="text-muted-foreground">Assignee</span>
              <Select value={assigneeValue} onValueChange={handleAssigneeChange}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {Object.entries(agents).map(([id, a]) => (
                    <SelectItem key={`agent:${id}`} value={`agent:${id}`}>
                      Agent: {a.name}
                    </SelectItem>
                  ))}
                  {Object.entries(teams).map(([id, t]) => (
                    <SelectItem key={`team:${id}`} value={`team:${id}`}>
                      Team: {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="text-muted-foreground">Project</span>
              <Select
                value={task.projectId || "none"}
                onValueChange={handleProjectChange}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects
                    .filter((p) => p.status === "active")
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>

              <span className="text-muted-foreground">Created</span>
              <span className="text-xs text-muted-foreground self-center">
                {new Date(task.createdAt).toLocaleString()}
              </span>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Description
              </label>
              {editingDesc ? (
                <Textarea
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={handleSaveDesc}
                  rows={4}
                  className="text-sm resize-none"
                  autoFocus
                />
              ) : (
                <div
                  className="text-sm min-h-[60px] p-2 border border-transparent hover:border-border rounded cursor-pointer transition-colors whitespace-pre-wrap"
                  onClick={() => {
                    setDescDraft(task.description);
                    setEditingDesc(true);
                  }}
                >
                  {task.description || (
                    <span className="text-muted-foreground/50">
                      Add a description...
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Comments */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">
                  Comments ({comments?.length ?? 0})
                </span>
              </div>

              <div className="space-y-3">
                {(comments ?? []).map((c) => (
                  <div
                    key={c.id}
                    className="group flex gap-2.5 text-sm"
                  >
                    <div className="shrink-0 mt-0.5">
                      {c.authorType === "agent" ? (
                        <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                          <Bot className="h-3 w-3 text-primary" />
                        </div>
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                          <User className="h-3 w-3 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs">
                          {c.author}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {timeAgo(c.createdAt)}
                        </span>
                        <button
                          onClick={() => handleDeleteComment(c.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-auto"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="text-sm whitespace-pre-wrap mt-0.5">
                        {c.content}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={commentsEndRef} />
              </div>
            </div>
          </div>
        </div>

        {/* Comment input */}
        <div className="border-t p-3">
          <div className="flex gap-2">
            <Input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Write a comment..."
              className="text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAddComment();
                }
              }}
            />
            <Button
              size="icon"
              onClick={handleAddComment}
              disabled={!commentText.trim() || submitting}
              className="shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
