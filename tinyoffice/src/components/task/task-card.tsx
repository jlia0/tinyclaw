import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KanbanItem, KanbanItemHandle } from "@/components/ui/kanban";
import {
  GripVertical,
  MoreVertical,
  Bot,
  Users,
  Pencil,
  Trash2,
  Send,
} from "lucide-react";
import type { Task, AgentConfig, TeamConfig, Project } from "@/lib/api";

interface TaskCardProps {
  task: Task;
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  projects: Project[];
  onDelete: (id: string) => void;
  onAssign: (task: Task) => void;
  onEdit: (task: Task) => void;
}

export function TaskCard({
  task,
  agents,
  teams,
  projects,
  onDelete,
  onAssign,
  onEdit,
}: TaskCardProps) {
  const project = task.projectId
    ? projects.find((p) => p.id === task.projectId)
    : null;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const assigneeName = task.assignee
    ? task.assigneeType === "team"
      ? teams[task.assignee]?.name || task.assignee
      : agents[task.assignee]?.name || task.assignee
    : null;

  return (
    <KanbanItem value={task.id} asHandle={false}>
      <Card
        className="border-border hover:border-primary/30 transition-colors cursor-pointer group"
        onClick={() => onEdit(task)}
      >
        <CardContent className="p-3 space-y-1.5">
          {/* Top row: identifier + actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <KanbanItemHandle
                className="shrink-0 text-muted-foreground/30 hover:text-foreground transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical className="h-3 w-3" />
              </KanbanItemHandle>
              <span
                className="text-xs font-mono font-semibold shrink-0"
                style={{ color: project?.color || "var(--muted-foreground)" }}
              >
                {task.identifier || `T-${task.number}`}
              </span>
            </div>
            <DropdownMenu
              open={confirmDelete ? true : undefined}
              onOpenChange={(open) => {
                if (!open) setConfirmDelete(false);
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-foreground transition-all"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {task.assignee && task.status === "backlog" && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssign(task);
                    }}
                  >
                    <Send className="h-3.5 w-3.5 mr-2" />
                    Send to agent
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(task);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {confirmDelete ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(task.id);
                      setConfirmDelete(false);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Confirm delete
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(true);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Title */}
          <p className="text-sm font-medium leading-snug pl-5">{task.title}</p>

          {/* Description preview */}
          {task.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 pl-5">
              {task.description}
            </p>
          )}

          {/* Bottom: assignee + date */}
          <div className="flex items-center gap-1.5 pl-5 pt-0.5">
            {assigneeName ? (
              <Badge
                variant="secondary"
                className="text-[10px] flex items-center gap-1 h-5"
              >
                {task.assigneeType === "team" ? (
                  <Users className="h-2.5 w-2.5" />
                ) : (
                  <Bot className="h-2.5 w-2.5" />
                )}
                {assigneeName}
              </Badge>
            ) : (
              <span className="text-[10px] text-muted-foreground/40">
                Unassigned
              </span>
            )}
            <span className="text-[9px] text-muted-foreground/40 ml-auto">
              {new Date(task.createdAt).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </KanbanItem>
  );
}
