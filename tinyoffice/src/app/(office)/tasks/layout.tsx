"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePolling } from "@/lib/hooks";
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  type Project,
} from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarInset,
} from "@/components/ui/sidebar";
import {
  ClipboardList,
  Plus,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  MoreHorizontal,
  X,
} from "lucide-react";

export default function TasksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const activeProject = searchParams.get("project");

  const { data: projects, refresh } = usePolling<Project[]>(getProjects, 3000);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const activeProjects = (projects || []).filter((p) => p.status === "active");
  const archivedProjects = (projects || []).filter(
    (p) => p.status === "archived"
  );

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      await createProject({
        name: newName.trim(),
        description: newDesc.trim(),
      });
      setNewName("");
      setNewDesc("");
      setShowCreateDialog(false);
      refresh();
    } catch {
      // ignore
    }
  }, [newName, newDesc, refresh]);

  const handleRename = useCallback(
    async (id: string) => {
      if (!editName.trim()) return;
      try {
        await updateProject(id, { name: editName.trim() });
        setEditingId(null);
        refresh();
      } catch {
        // ignore
      }
    },
    [editName, refresh]
  );

  const handleArchive = useCallback(
    async (project: Project) => {
      await updateProject(project.id, {
        status: project.status === "archived" ? "active" : "archived",
      });
      refresh();
    },
    [refresh]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteProject(id);
      refresh();
    },
    [refresh]
  );

  return (
    <SidebarProvider defaultOpen={true} className="h-full">
      <Sidebar collapsible="none" className="border-r h-full">
        <SidebarHeader className="px-3 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Workspace
          </span>
        </SidebarHeader>

        <SidebarContent>
          {/* Navigation */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={!activeProject}
                    tooltip="All Tasks"
                  >
                    <Link href="/tasks">
                      <ClipboardList className="h-4 w-4" />
                      <span>All Tasks</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Projects */}
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction
              title="New project"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="h-4 w-4" />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {activeProjects.map((project) => (
                  <SidebarMenuItem key={project.id}>
                    {editingId === project.id ? (
                      <div className="flex items-center gap-1 px-1 py-0.5">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(project.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-7 text-sm"
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <SidebarMenuButton
                          asChild
                          isActive={activeProject === project.id}
                          tooltip={project.name}
                        >
                          <Link href={`/tasks?project=${project.id}`}>
                            <div
                              className="h-3.5 w-3.5 rounded shrink-0"
                              style={{ backgroundColor: project.color }}
                            />
                            <span className="truncate">{project.name}</span>
                          </Link>
                        </SidebarMenuButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction>
                              <MoreHorizontal className="h-4 w-4" />
                            </SidebarMenuAction>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingId(project.id);
                                setEditName(project.name);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span>Rename</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleArchive(project)}
                            >
                              <Archive className="h-3.5 w-3.5" />
                              <span>Archive</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => handleDelete(project.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Delete</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Archived */}
          {archivedProjects.length > 0 && (
            <SidebarGroup>
              <SidebarGroupLabel
                className="cursor-pointer"
                onClick={() => setShowArchived(!showArchived)}
              >
                {showArchived ? (
                  <ChevronDown className="h-3 w-3 mr-1" />
                ) : (
                  <ChevronRight className="h-3 w-3 mr-1" />
                )}
                Archived ({archivedProjects.length})
              </SidebarGroupLabel>
              {showArchived && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    {archivedProjects.map((project) => (
                      <SidebarMenuItem key={project.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={activeProject === project.id}
                          tooltip={project.name}
                          className="opacity-60"
                        >
                          <Link href={`/tasks?project=${project.id}`}>
                            <div
                              className="h-3.5 w-3.5 rounded shrink-0 opacity-50"
                              style={{ backgroundColor: project.color }}
                            />
                            <span className="truncate">{project.name}</span>
                          </Link>
                        </SidebarMenuButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction>
                              <MoreHorizontal className="h-4 w-4" />
                            </SidebarMenuAction>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start">
                            <DropdownMenuItem
                              onClick={() => handleArchive(project)}
                            >
                              <ArchiveRestore className="h-3.5 w-3.5" />
                              <span>Unarchive</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => handleDelete(project.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Delete</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          )}
        </SidebarContent>
      </Sidebar>

      {/* Create project dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm bg-card border rounded-lg shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">New Project</h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewName("");
                  setNewDesc("");
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Project name"
                className="text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) handleCreate();
                  if (e.key === "Escape") {
                    setShowCreateDialog(false);
                    setNewName("");
                    setNewDesc("");
                  }
                }}
              />
              <Textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="text-sm resize-none"
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewName("");
                  setNewDesc("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!newName.trim()}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
