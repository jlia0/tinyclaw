import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Users } from "lucide-react";
import type { Task, AgentConfig, TeamConfig } from "@/lib/api";

interface TaskCardOverlayProps {
  task: Task;
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
}

export function TaskCardOverlay({
  task,
  agents,
  teams,
}: TaskCardOverlayProps) {
  return (
    <Card className="border-primary/50 shadow-lg w-[280px]">
      <CardContent className="p-3 space-y-1">
        <span className="text-xs font-mono font-semibold text-muted-foreground">
          {task.identifier || `T-${task.number}`}
        </span>
        <p className="text-sm font-medium">{task.title}</p>
        {task.assignee && (
          <Badge
            variant="secondary"
            className="text-[10px] flex items-center gap-1 w-fit"
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
        )}
      </CardContent>
    </Card>
  );
}
