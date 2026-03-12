const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  provider: string;
  model: string;
  working_directory: string;
  system_prompt?: string;
  prompt_file?: string;
}

export interface TeamConfig {
  name: string;
  agents: string[];
  leader_agent: string;
}

export interface Settings {
  workspace?: { path?: string; name?: string };
  channels?: {
    enabled?: string[];
    discord?: { bot_token?: string };
    telegram?: { bot_token?: string };
    whatsapp?: Record<string, unknown>;
  };
  models?: {
    provider?: string;
    anthropic?: { model?: string };
    openai?: { model?: string };
    opencode?: { model?: string };
  };
  agents?: Record<string, AgentConfig>;
  teams?: Record<string, TeamConfig>;
  monitoring?: { heartbeat_interval?: number };
}

export interface QueueStatus {
  incoming: number;
  processing: number;
  outgoing: number;
  activeConversations: number;
}

export interface ResponseData {
  channel: string;
  sender: string;
  message: string;
  originalMessage: string;
  timestamp: number;
  messageId: string;
  agent?: string;
  files?: string[];
}

export interface EventData {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

// ── API Functions ─────────────────────────────────────────────────────────

export async function getAgents(): Promise<Record<string, AgentConfig>> {
  return apiFetch("/api/agents");
}

export async function getTeams(): Promise<Record<string, TeamConfig>> {
  return apiFetch("/api/teams");
}

export async function getSettings(): Promise<Settings> {
  return apiFetch("/api/settings");
}

export async function updateSettings(settings: Partial<Settings>): Promise<{ ok: boolean; settings: Settings }> {
  return apiFetch("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
}

export async function getQueueStatus(): Promise<QueueStatus> {
  return apiFetch("/api/queue/status");
}

export async function getResponses(limit = 20): Promise<ResponseData[]> {
  return apiFetch(`/api/responses?limit=${limit}`);
}

export async function getLogs(limit = 100): Promise<{ lines: string[] }> {
  return apiFetch(`/api/logs?limit=${limit}`);
}

export async function saveAgent(
  id: string,
  agent: AgentConfig
): Promise<{ ok: boolean; agent: AgentConfig }> {
  return apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(agent),
  });
}

export async function deleteAgent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function saveTeam(
  id: string,
  team: TeamConfig
): Promise<{ ok: boolean; team: TeamConfig }> {
  return apiFetch(`/api/teams/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(team),
  });
}

export async function deleteTeam(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/teams/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function sendMessage(payload: {
  message: string;
  agent?: string;
  sender?: string;
  channel?: string;
}): Promise<{ ok: boolean; messageId: string }> {
  return apiFetch("/api/message", { method: "POST", body: JSON.stringify(payload) });
}

// ── Tasks ─────────────────────────────────────────────────────────────────

export type TaskStatus = "backlog" | "in_progress" | "review" | "done";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string;
  assigneeType: "agent" | "team" | "";
  projectId?: string;
  createdAt: number;
  updatedAt: number;
}

export async function getTasks(): Promise<Task[]> {
  return apiFetch("/api/tasks");
}

export async function createTask(task: Partial<Task>): Promise<{ ok: boolean; task: Task }> {
  return apiFetch("/api/tasks", { method: "POST", body: JSON.stringify(task) });
}

export async function updateTask(id: string, task: Partial<Task>): Promise<{ ok: boolean; task: Task }> {
  return apiFetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(task) });
}

export async function deleteTask(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function reorderTasks(columns: Record<string, string[]>): Promise<{ ok: boolean }> {
  return apiFetch("/api/tasks/reorder", { method: "PUT", body: JSON.stringify({ columns }) });
}

// ── Chat Rooms ───────────────────────────────────────────────────────────

export interface ChatRoom {
  id: string;
  name: string;
  description: string;
  members: string[];       // agent IDs and/or team IDs
  createdAt: number;
  updatedAt: number;
}

function getRoomsFromStorage(): ChatRoom[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("tinyclaw_rooms") || "[]");
  } catch { return []; }
}

function saveRoomsToStorage(rooms: ChatRoom[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("tinyclaw_rooms", JSON.stringify(rooms));
}

export async function getChatRooms(): Promise<ChatRoom[]> {
  return getRoomsFromStorage();
}

export async function createChatRoom(room: Omit<ChatRoom, "id" | "createdAt" | "updatedAt">): Promise<ChatRoom> {
  const rooms = getRoomsFromStorage();
  const newRoom: ChatRoom = {
    ...room,
    id: room.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `room-${Date.now()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Ensure unique ID
  if (rooms.find(r => r.id === newRoom.id)) {
    newRoom.id = `${newRoom.id}-${Date.now().toString(36).slice(-4)}`;
  }
  rooms.push(newRoom);
  saveRoomsToStorage(rooms);
  return newRoom;
}

export async function updateChatRoom(id: string, updates: Partial<ChatRoom>): Promise<ChatRoom> {
  const rooms = getRoomsFromStorage();
  const idx = rooms.findIndex(r => r.id === id);
  if (idx === -1) throw new Error("Room not found");
  rooms[idx] = { ...rooms[idx], ...updates, updatedAt: Date.now() };
  saveRoomsToStorage(rooms);
  return rooms[idx];
}

export async function deleteChatRoom(id: string): Promise<void> {
  const rooms = getRoomsFromStorage().filter(r => r.id !== id);
  saveRoomsToStorage(rooms);
}

// ── Projects ─────────────────────────────────────────────────────────────

export type ProjectStatus = "active" | "paused" | "completed" | "archived";

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  agents: string[];        // assigned agent IDs
  teams: string[];         // assigned team IDs
  createdAt: number;
  updatedAt: number;
}

function getProjectsFromStorage(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("tinyclaw_projects") || "[]");
  } catch { return []; }
}

function saveProjectsToStorage(projects: Project[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("tinyclaw_projects", JSON.stringify(projects));
}

export async function getProjects(): Promise<Project[]> {
  return getProjectsFromStorage();
}

export async function createProject(project: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project> {
  const projects = getProjectsFromStorage();
  const newProject: Project = {
    ...project,
    id: project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `proj-${Date.now()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (projects.find(p => p.id === newProject.id)) {
    newProject.id = `${newProject.id}-${Date.now().toString(36).slice(-4)}`;
  }
  projects.push(newProject);
  saveProjectsToStorage(projects);
  return newProject;
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<Project> {
  const projects = getProjectsFromStorage();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) throw new Error("Project not found");
  projects[idx] = { ...projects[idx], ...updates, updatedAt: Date.now() };
  saveProjectsToStorage(projects);
  return projects[idx];
}

export async function deleteProject(id: string): Promise<void> {
  const projects = getProjectsFromStorage().filter(p => p.id !== id);
  saveProjectsToStorage(projects);
}

// ── SSE ───────────────────────────────────────────────────────────────────

export function subscribeToEvents(
  onEvent: (event: EventData) => void,
  onError?: (err: Event) => void
): () => void {
  const es = new EventSource(`${API_BASE}/api/events/stream`);

  const handler = (e: MessageEvent) => {
    try { onEvent(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
  };

  // Listen to all known event types
  const eventTypes = [
    "message_received", "agent_routed", "chain_step_start", "chain_step_done",
    "chain_handoff", "team_chain_start", "team_chain_end", "response_ready",
    "processor_start", "message_enqueued",
  ];
  for (const type of eventTypes) {
    es.addEventListener(type, handler);
  }

  if (onError) es.onerror = onError;

  return () => es.close();
}
