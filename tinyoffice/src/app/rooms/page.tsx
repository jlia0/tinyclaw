"use client";

import { useState, useCallback } from "react";
import { usePolling } from "@/lib/hooks";
import {
  getAgents, getTeams, getChatRooms, createChatRoom, updateChatRoom, deleteChatRoom,
  type AgentConfig, type TeamConfig, type ChatRoom,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Hash, Plus, Pencil, Trash2, X, Check, Loader2, Bot, Users,
} from "lucide-react";

export default function RoomsPage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const { data: rooms, refresh } = usePolling<ChatRoom[]>(getChatRooms, 2000);
  const [editing, setEditing] = useState<{
    isNew: boolean;
    id: string;
    name: string;
    description: string;
    members: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const openNew = () => {
    setEditing({ isNew: true, id: "", name: "", description: "", members: [] });
    setError("");
  };

  const openEdit = (room: ChatRoom) => {
    setEditing({
      isNew: false,
      id: room.id,
      name: room.name,
      description: room.description,
      members: [...room.members],
    });
    setError("");
  };

  const cancel = () => { setEditing(null); setError(""); };

  const toggleMember = (memberId: string) => {
    if (!editing) return;
    const has = editing.members.includes(memberId);
    setEditing({
      ...editing,
      members: has
        ? editing.members.filter(m => m !== memberId)
        : [...editing.members, memberId],
    });
  };

  const handleSave = useCallback(async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing.isNew) {
        await createChatRoom({
          name: editing.name.trim(),
          description: editing.description.trim(),
          members: editing.members,
        });
      } else {
        await updateChatRoom(editing.id, {
          name: editing.name.trim(),
          description: editing.description.trim(),
          members: editing.members,
        });
      }
      setEditing(null);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editing, refresh]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteChatRoom(id);
      refresh();
    } catch { /* ignore */ }
  }, [refresh]);

  const agentEntries = agents ? Object.entries(agents) : [];
  const teamEntries = teams ? Object.entries(teams) : [];

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Hash className="h-5 w-5 text-primary" />
            Chat Rooms
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Slack-like channels for agent conversations
          </p>
        </div>
        <Button onClick={openNew} disabled={!!editing}>
          <Plus className="h-4 w-4" />
          New Room
        </Button>
      </div>

      {/* Editor */}
      {editing && (
        <Card className="border-primary/50">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              {editing.isNew ? <Plus className="h-4 w-4 text-primary" /> : <Pencil className="h-4 w-4 text-primary" />}
              {editing.isNew ? "New Chat Room" : `Edit #${editing.id}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Room Name</label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g. general"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <Input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="What's this room about?"
                />
              </div>
            </div>

            {/* Member selection */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Members
                {editing.members.length > 0 && (
                  <span className="ml-2 text-primary">{editing.members.length} selected</span>
                )}
              </label>
              <p className="text-[10px] text-muted-foreground">
                Select agents and teams whose messages appear in this room. Leave empty to see all messages.
              </p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {agentEntries.map(([id, agent]) => {
                  const selected = editing.members.includes(id);
                  return (
                    <div
                      key={id}
                      className={`flex items-center gap-2 border px-3 py-2 cursor-pointer transition-colors ${
                        selected ? "border-primary/50 bg-primary/5" : "border-border hover:border-muted-foreground/50"
                      }`}
                      onClick={() => toggleMember(id)}
                    >
                      <Bot className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{agent.name}</p>
                        <p className="text-[10px] text-muted-foreground">@{id}</p>
                      </div>
                    </div>
                  );
                })}
                {teamEntries.map(([id, team]) => {
                  const selected = editing.members.includes(id);
                  return (
                    <div
                      key={id}
                      className={`flex items-center gap-2 border px-3 py-2 cursor-pointer transition-colors ${
                        selected ? "border-primary/50 bg-primary/5" : "border-border hover:border-muted-foreground/50"
                      }`}
                      onClick={() => toggleMember(id)}
                    >
                      <Users className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{team.name}</p>
                        <p className="text-[10px] text-muted-foreground">@{id} &middot; {team.agents.length} agents</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {editing.isNew ? "Create Room" : "Save Changes"}
              </Button>
              <Button variant="ghost" onClick={cancel} disabled={saving}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Room list */}
      {rooms && rooms.length > 0 ? (
        <div className="space-y-3">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              agents={agents || {}}
              teams={teams || {}}
              onEdit={() => openEdit(room)}
              onDelete={() => handleDelete(room.id)}
            />
          ))}
        </div>
      ) : !editing ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Hash className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No chat rooms yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a room to start monitoring agent conversations
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Info card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">How Chat Rooms Work</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">1</div>
            <p>Chat rooms are channels that aggregate messages from selected agents and teams, like Slack channels.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">2</div>
            <p>All agent activity (messages, responses, routing events) from room members appears in real time.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-primary/10 text-primary text-xs font-bold shrink-0">3</div>
            <p>You can send messages to any room member directly from within the room.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RoomCard({
  room, agents, teams, onEdit, onDelete,
}: {
  room: ChatRoom;
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card className="transition-colors hover:border-primary/50">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold">{room.name}</p>
              {room.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{room.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit} className="h-7 w-7">
              <Pencil className="h-3 w-3" />
            </Button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button variant="destructive" size="sm" onClick={() => { onDelete(); setConfirmDelete(false); }} className="h-7 text-xs">
                  Delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="h-7 text-xs">
                  No
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Members */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {room.members.length === 0 ? (
            <span className="text-[10px] text-muted-foreground">All agents (no filter)</span>
          ) : (
            room.members.map((memberId) => {
              const agent = agents[memberId];
              const team = teams[memberId];
              return (
                <Badge key={memberId} variant="secondary" className="text-[10px] flex items-center gap-1">
                  {team ? <Users className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />}
                  {agent?.name || team?.name || memberId}
                </Badge>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
