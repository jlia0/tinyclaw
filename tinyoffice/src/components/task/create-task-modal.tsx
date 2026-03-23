import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Check, Loader2 } from "lucide-react";
import { createTask } from "@/lib/api";
import type { AgentConfig, TeamConfig, Project } from "@/lib/api";
import { TaskForm, emptyForm, type TaskFormData } from "./task-form";

interface CreateTaskModalProps {
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  projects: Project[];
  defaultProjectId?: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTaskModal({
  agents,
  teams,
  projects,
  defaultProjectId,
  onClose,
  onCreated,
}: CreateTaskModalProps) {
  const [form, setForm] = useState<TaskFormData>({ ...emptyForm, projectId: defaultProjectId || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [form, onCreated, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <Card className="w-full max-w-lg border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">New Task</p>
              <p className="text-xs text-muted-foreground">
                Create and assign work
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setError("");
                onClose();
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <TaskForm
            form={form}
            onChange={setForm}
            agents={agents}
            teams={teams}
            projects={projects}
            error={error}
          />
          <div className="flex items-center gap-2">
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Create
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setError("");
                onClose();
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
  );
}
