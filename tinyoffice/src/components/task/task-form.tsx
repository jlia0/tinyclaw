import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { AgentConfig, TeamConfig, Project } from "@/lib/api";

export interface TaskFormData {
  title: string;
  description: string;
  assignee: string;
  assigneeType: "agent" | "team" | "";
  projectId: string;
}

export const emptyForm: TaskFormData = {
  title: "",
  description: "",
  assignee: "",
  assigneeType: "",
  projectId: "",
};

interface TaskFormProps {
  form: TaskFormData;
  onChange: (form: TaskFormData) => void;
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  projects: Project[];
  error?: string;
}

export function TaskForm({
  form,
  onChange,
  agents,
  teams,
  projects,
  error,
}: TaskFormProps) {
  const setAssignee = (value: string) => {
    if (value === "none" || !value) {
      onChange({ ...form, assignee: "", assigneeType: "" });
      return;
    }
    const [type, id] = value.split(":");
    onChange({ ...form, assignee: id, assigneeType: type as "agent" | "team" });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Title
        </label>
        <Input
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          placeholder="Task title"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Description
        </label>
        <Textarea
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          rows={3}
          className="text-sm resize-none"
          placeholder="Description (optional)"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Assignee
          </label>
          <Select
            value={
              form.assignee
                ? `${form.assigneeType}:${form.assignee}`
                : "none"
            }
            onValueChange={setAssignee}
          >
            <SelectTrigger>
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
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Project
          </label>
          <Select
            value={form.projectId || "none"}
            onValueChange={(v) =>
              onChange({ ...form, projectId: v === "none" ? "" : v })
            }
          >
            <SelectTrigger>
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
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
