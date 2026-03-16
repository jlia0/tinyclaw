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
  FolderKanban,
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
      <Card className="border-border hover:border-primary/30 transition-colors">
        <CardContent className="p-3 space-y-2">
          {/* Title row with grip and actions */}
          <div className="flex items-start gap-2">
            <KanbanItemHandle className="mt-0.5 shrink-0 text-muted-foreground/40 hover:text-foreground transition-colors">
              <GripVertical className="h-3.5 w-3.5" />
            </KanbanItemHandle>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-tight">{task.title}</p>
              {task.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                  {task.description}
                </p>
              )}
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
                  className="h-6 w-6 shrink-0 text-muted-foreground/50 hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
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

          {/* Metadata row */}
          <div className="flex items-center gap-1.5 pl-5.5 flex-wrap">
            {project && (
              <Badge
                variant="outline"
                className="text-[10px] flex items-center gap-1"
              >
                <FolderKanban className="h-2.5 w-2.5" />
                {project.name}
              </Badge>
            )}
            {assigneeName ? (
              <Badge
                variant="secondary"
                className="text-[10px] flex items-center gap-1"
              >
                {task.assigneeType === "team" ? (
                  <Users className="h-2.5 w-2.5" />
                ) : (
                  <Bot className="h-2.5 w-2.5" />
                )}
                {assigneeName}
              </Badge>
            ) : (
              <span className="text-[10px] text-muted-foreground/50">
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
