import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Check, Loader2 } from "lucide-react";
import { updateTask } from "@/lib/api";
import type { Task, AgentConfig, TeamConfig, Project } from "@/lib/api";
import { TaskForm, type TaskFormData } from "./task-form";

interface EditTaskModalProps {
  task: Task;
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}

export function EditTaskModal({
  task,
  agents,
  teams,
  projects,
  onClose,
  onSaved,
}: EditTaskModalProps) {
  const [form, setForm] = useState<TaskFormData>({
    title: task.title,
    description: task.description,
    assignee: task.assignee || "",
    assigneeType: task.assigneeType || "",
    projectId: task.projectId || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = useCallback(async () => {
    if (!form.title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateTask(task.id, {
        title: form.title.trim(),
        description: form.description.trim(),
        assignee: form.assignee || "",
        assigneeType: form.assignee ? form.assigneeType : "",
        projectId: form.projectId || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [task.id, form, onSaved, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <Card className="w-full max-w-lg border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Edit Task</p>
              <p className="text-xs text-muted-foreground">{task.title}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
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
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
