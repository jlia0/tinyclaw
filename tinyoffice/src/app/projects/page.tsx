"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { usePolling } from "@/lib/hooks";
import {
  getProjects, createProject, updateProject, deleteProject,
  getTasks,
  type Project, type Task,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  FolderKanban, Plus, Pencil, Trash2, X, Check, Loader2,
  ClipboardList, Archive, ArrowRight,
} from "lucide-react";

export default function ProjectsPage() {
  const { data: projects, refresh } = usePolling<Project[]>(getProjects, 3000);
  const { data: tasks } = usePolling<Task[]>(getTasks, 5000);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  const taskCountForProject = (projectId: string) =>
    tasks?.filter((t) => t.projectId === projectId).length ?? 0;

  const activeTaskCountForProject = (projectId: string) =>
    tasks?.filter((t) => t.projectId === projectId && t.status !== "done").length ?? 0;

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setForm({ name: "", description: "" });
    setError("");
  };

  const openEdit = (project: Project) => {
    setEditing(project.id);
    setCreating(false);
    setForm({ name: project.name, description: project.description });
    setError("");
  };

  const cancel = () => {
    setCreating(false);
    setEditing(null);
    setForm({ name: "", description: "" });
    setError("");
  };

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await updateProject(editing, { name: form.name.trim(), description: form.description.trim() });
      } else {
        await createProject({ name: form.name.trim(), description: form.description.trim() });
      }
      cancel();
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [form, editing, refresh]);

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      await deleteProject(id);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }, [refresh]);

  const handleArchive = useCallback(async (project: Project) => {
    try {
      await updateProject(project.id, {
        status: project.status === "archived" ? "active" : "archived",
      });
      refresh();
    } catch {
      // ignore
    }
  }, [refresh]);

  const activeProjects = (projects || []).filter((p) => p.status === "active");
  const archivedProjects = (projects || []).filter((p) => p.status === "archived");

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-primary" />
            Projects
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Organize work into projects with associated tasks
          </p>
        </div>
        <Button onClick={openCreate} disabled={creating || !!editing}>
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Create / Edit modal */}
      {(creating || editing) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <Card className="w-full max-w-lg border-border">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {creating ? "New Project" : "Edit Project"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {creating ? "Set up a new project" : "Update project details"}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={cancel}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Auth System Redesign"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What is this project about?"
                  rows={3}
                  className="text-sm resize-none"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex items-center gap-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {creating ? "Create" : "Save"}
                </Button>
                <Button variant="ghost" onClick={cancel} disabled={saving}>
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active Projects */}
      {activeProjects.length > 0 ? (
        <div className="space-y-4">
          {activeProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              taskCount={taskCountForProject(project.id)}
              activeTaskCount={activeTaskCountForProject(project.id)}
              onEdit={() => openEdit(project)}
              onDelete={() => handleDelete(project.id)}
              onArchive={() => handleArchive(project)}
              deleting={deleting === project.id}
            />
          ))}
        </div>
      ) : !creating && !editing ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No projects yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a project to group related tasks together
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Archived Projects */}
      {archivedProjects.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Archive className="h-3.5 w-3.5" />
            Archived
          </h2>
          {archivedProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              taskCount={taskCountForProject(project.id)}
              activeTaskCount={activeTaskCountForProject(project.id)}
              onEdit={() => openEdit(project)}
              onDelete={() => handleDelete(project.id)}
              onArchive={() => handleArchive(project)}
              deleting={deleting === project.id}
            />
          ))}
        </div>
      )}

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">How Projects Work</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">1</div>
            <p>Create a project to represent a larger goal or initiative.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">2</div>
            <p>Link tasks to projects from the Tasks kanban board.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">3</div>
            <p>View a project to see its filtered kanban board with only associated tasks.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectCard({
  project,
  taskCount,
  activeTaskCount,
  onEdit,
  onDelete,
  onArchive,
  deleting,
}: {
  project: Project;
  taskCount: number;
  activeTaskCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onArchive: () => void;
  deleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card className={`transition-colors hover:border-primary/50 ${project.status === "archived" ? "opacity-60" : ""}`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <Link href={`/projects/${project.id}`}>
              <CardTitle className="text-lg hover:text-primary transition-colors cursor-pointer flex items-center gap-2">
                {project.name}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
            </Link>
            {project.description && (
              <CardDescription className="mt-1">{project.description}</CardDescription>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-4">
            <Badge variant="outline" className="flex items-center gap-1">
              <ClipboardList className="h-3 w-3" />
              {taskCount} task{taskCount !== 1 ? "s" : ""}
            </Badge>
            {activeTaskCount > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {activeTaskCount} active
              </Badge>
            )}
            <Button variant="ghost" size="icon" onClick={onArchive} className="h-8 w-8" title={project.status === "archived" ? "Unarchive" : "Archive"}>
              <Archive className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onEdit} className="h-8 w-8">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => { onDelete(); setConfirmDelete(false); }}
                  disabled={deleting}
                  className="h-8 text-xs"
                >
                  {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="h-8 text-xs">
                  No
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
