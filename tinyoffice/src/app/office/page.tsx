"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Send } from "lucide-react";

import {
  PixelOfficeScene,
  PIXEL_SCENE_LAYOUT,
  getTaskStationMemberSpot,
  getLoungeMemberSpot,
  pointToPercent,
  type PixelDeskStatus,
  type SceneAgent,
  type SceneArchiveRoom,
  type SceneBossRoom,
  type SceneLounge,
  type SceneQueueSnapshot,
  type SceneResponseItem,
  type SceneRouteTarget,
  type SceneTaskStation,
  type SceneTaskSummary,
} from "@/components/pixel-office-scene";
import { usePolling } from "@/lib/hooks";
import {
  getAgentMessages,
  getAgents,
  getLogs,
  getQueueStatus,
  getResponses,
  getSettings,
  getTasks,
  getTeams,
  sendMessage,
  subscribeToEvents,
  type AgentConfig,
  type AgentMessage,
  type EventData,
  type QueueStatus,
  type ResponseData,
  type Settings,
  type Task,
  type TeamConfig,
} from "@/lib/api";

type LiveBubble = {
  id: string;
  agentId: string;
  message: string;
  timestamp: number;
  targetAgents: string[];
};

type TeamGroup = {
  id: string;
  label: string;
  memberIds: string[];
  color: string;
};

type StationAssignment = {
  stationIndex: number;
  kind: "task" | "route";
  status: PixelDeskStatus;
  startAt: number;
  responseAt?: number;
  label: string;
  speaker?: boolean;
};

type OverlayBubble = {
  id: string;
  x: number;
  y: number;
  color: string;
  heading: string;
  message: string;
};

type ConversationEntry = {
  id: string;
  timestamp: number;
  role: "user" | "agent";
  agentId?: string;
  sender: string;
  message: string;
  targetAgents: string[];
  sourceOrder: number;
};

type AgentWorkSession = {
  rootMessageId: string;
  startedAt: number;
  completedAt?: number;
};

const AGENT_COLORS = ["#a3e635", "#84cc16", "#f59e0b", "#14b8a6", "#eab308", "#22c55e"];
const AGENT_SESSION_RELEASE_MS = 6200;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeInOut(progress: number) {
  return progress * progress * (3 - 2 * progress);
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function interpolatePoint(from: { x: number; y: number }, to: { x: number; y: number }, progress: number) {
  return {
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
  };
}

function trimText(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function extractTargets(message: string) {
  const targets: string[] = [];
  for (const match of message.matchAll(/\[@(\w[\w-]*?):/g)) {
    if (!targets.includes(match[1])) targets.push(match[1]);
  }
  if (targets.length === 0) {
    const direct = message.match(/^@(\w[\w-]*)/);
    if (direct) targets.push(direct[1]);
  }
  return targets;
}

function isErrorMessage(message: string) {
  return /\b(error|failed|failure|exception|timeout)\b/i.test(message);
}

function taskTone(task: Task): PixelDeskStatus {
  if (task.status === "done") return "done";
  if (task.status === "review") return "pending";
  if (task.status === "in_progress") return "running";
  return "empty";
}

function routeTone(message: string): PixelDeskStatus {
  return isErrorMessage(message) ? "error" : "running";
}

function responseTone(response: ResponseData): PixelDeskStatus {
  return isErrorMessage(response.message) ? "error" : "done";
}

function buildTeamGroups(
  agents: Record<string, AgentConfig> | null,
  teams: Record<string, TeamConfig> | null,
) {
  if (!agents) return [] as TeamGroup[];

  const allAgentIds = Object.keys(agents);
  const groupedIds = new Set<string>();
  const groups: TeamGroup[] = [];
  const teamEntries = teams ? Object.entries(teams) : [];

  teamEntries.forEach(([teamId, team], index) => {
    const members = team.agents.filter((memberId) => allAgentIds.includes(memberId));
    members.forEach((memberId) => groupedIds.add(memberId));
    if (members.length === 0) return;
    groups.push({
      id: teamId,
      label: team.name || teamId,
      memberIds: members,
      color: AGENT_COLORS[index % AGENT_COLORS.length],
    });
  });

  const independent = allAgentIds.filter((agentId) => !groupedIds.has(agentId));
  if (independent.length > 0) {
    groups.push({
      id: "independent",
      label: "Independent",
      memberIds: independent,
      color: AGENT_COLORS[groups.length % AGENT_COLORS.length],
    });
  }

  return groups;
}

function responseSubtitle(response: ResponseData) {
  return response.agent ? `@${response.agent} -> ${response.channel}` : response.channel;
}

export default function OfficePage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const { data: tasks } = usePolling<Task[]>(getTasks, 4000);
  const { data: queueStatus } = usePolling<QueueStatus>(getQueueStatus, 2500);
  const { data: responses } = usePolling<ResponseData[]>(() => getResponses(6), 4000);
  const { data: settings } = usePolling<Settings>(getSettings, 10000);
  const { data: logs } = usePolling<{ lines: string[] }>(() => getLogs(40), 5000);
  const { data: agentHistories } = usePolling<Record<string, AgentMessage[]>>(
    async () => {
      if (!agents) return {};
      const entries = await Promise.all(
        Object.keys(agents).map(async (agentId) => [agentId, await getAgentMessages(agentId, 40)] as const),
      );
      return Object.fromEntries(entries);
    },
    5000,
    [agents],
  );

  const [bubbles, setBubbles] = useState<LiveBubble[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState({ now: Date.now(), frame: 0 });
  const [archivePanel, setArchivePanel] = useState<"logs" | "workspace" | "outgoing" | "routing" | "tasks" | null>(null);
  const [conversationFilter, setConversationFilter] = useState<string>("all");
  const [agentWorkSessions, setAgentWorkSessions] = useState<Record<string, AgentWorkSession>>({});

  const seenRef = useRef(new Set<string>());
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const rootSessionsRef = useRef(new Map<string, { startedAt: number; agentIds: Set<string>; completedAt?: number }>());
  const openRootOrderRef = useRef<string[]>([]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClock((current) => ({ now: Date.now(), frame: current.frame + 1 }));
    }, 120);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setAgentWorkSessions((current) => {
      let changed = false;
      const next: Record<string, AgentWorkSession> = {};
      Object.entries(current).forEach(([agentId, session]) => {
        if (session.completedAt && Date.now() - session.completedAt > AGENT_SESSION_RELEASE_MS) {
          changed = true;
          return;
        }
        next[agentId] = session;
      });
      return changed ? next : current;
    });
  }, [clock.now]);

  useEffect(() => {
    const latestOpenRootId = () => {
      for (let index = openRootOrderRef.current.length - 1; index >= 0; index -= 1) {
        const messageId = openRootOrderRef.current[index];
        const session = rootSessionsRef.current.get(messageId);
        if (session && !session.completedAt) return messageId;
      }
      return null;
    };

    const attachAgentToLatestRoot = (agentId: string, timestamp: number) => {
      const rootMessageId = latestOpenRootId();
      if (!rootMessageId) return;

      const rootSession = rootSessionsRef.current.get(rootMessageId);
      if (!rootSession) return;

      rootSession.agentIds.add(agentId);
      setAgentWorkSessions((current) => {
        const existing = current[agentId];
        if (existing && existing.rootMessageId === rootMessageId && !existing.completedAt) {
          return current;
        }
        return {
          ...current,
          [agentId]: {
            rootMessageId,
            startedAt: existing && !existing.completedAt ? existing.startedAt : timestamp,
          },
        };
      });
    };

    const unsubscribe = subscribeToEvents(
      (event: EventData) => {
        setConnected(true);
        const fingerprint = `${event.type}:${event.timestamp}:${(event as Record<string, unknown>).messageId ?? ""}:${(event as Record<string, unknown>).agentId ?? ""}`;
        if (seenRef.current.has(fingerprint)) return;
        seenRef.current.add(fingerprint);
        if (seenRef.current.size > 500) {
          const entries = [...seenRef.current];
          seenRef.current = new Set(entries.slice(entries.length - 300));
        }

        const payload = event as Record<string, unknown>;
        const agentId = payload.agentId ? String(payload.agentId) : undefined;

        if (event.type === "message_enqueued") {
          const message = (payload.message as string) || "";
          const sender = (payload.sender as string) || "User";
          const messageId = payload.messageId ? String(payload.messageId) : undefined;
          if (!message) return;

          if (messageId) {
            rootSessionsRef.current.set(messageId, {
              startedAt: event.timestamp,
              agentIds: new Set<string>(),
            });
            openRootOrderRef.current = [...openRootOrderRef.current.filter((id) => id !== messageId), messageId];
          }

          setBubbles((current) =>
            [
              ...current,
              {
                id: `${event.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
                agentId: `_user_${sender}`,
                message,
                timestamp: event.timestamp,
                targetAgents: extractTargets(message),
              },
            ].slice(-80),
          );
        }

        if (event.type === "chain_step_start" && agentId) {
          attachAgentToLatestRoot(agentId, event.timestamp);
        }

        if (event.type === "chain_handoff") {
          const toAgent = payload.toAgent ? String(payload.toAgent) : undefined;
          const fromAgent = payload.fromAgent ? String(payload.fromAgent) : undefined;
          if (fromAgent) attachAgentToLatestRoot(fromAgent, event.timestamp);
          if (toAgent) attachAgentToLatestRoot(toAgent, event.timestamp);
        }

        if (event.type === "agent_message" && agentId) {
          attachAgentToLatestRoot(agentId, event.timestamp);
          const message = (payload.content as string) || "";
          if (!message) return;
          setBubbles((current) =>
            [
              ...current,
              {
                id: `${event.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
                agentId,
                message,
                timestamp: event.timestamp,
                targetAgents: extractTargets(message),
              },
            ].slice(-80),
          );
        }

        if (event.type === "response_ready") {
          const messageId = payload.messageId ? String(payload.messageId) : undefined;
          if (!messageId) return;
          const rootSession = rootSessionsRef.current.get(messageId);
          if (!rootSession) return;

          rootSession.completedAt = event.timestamp;
          openRootOrderRef.current = openRootOrderRef.current.filter((id) => id !== messageId);

          setAgentWorkSessions((current) => {
            const next = { ...current };
            rootSession.agentIds.forEach((sessionAgentId) => {
              const existing = next[sessionAgentId];
              if (!existing || existing.rootMessageId !== messageId) return;
              next[sessionAgentId] = { ...existing, completedAt: event.timestamp };
            });
            return next;
          });
        }
      },
      () => setConnected(false),
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const cutoff = Date.now() - 180000;
      setBubbles((current) => current.filter((bubble) => bubble.timestamp > cutoff));
    }, 2000);
    return () => window.clearInterval(interval);
  }, []);

  const handleSend = useCallback(async () => {
    if (!chatInput.trim() || sending) return;
    setSending(true);
    try {
      const message =
        conversationFilter !== "all" && !chatInput.trim().startsWith("@")
          ? `@${conversationFilter} ${chatInput.trim()}`
          : chatInput.trim();

      await sendMessage({ message, sender: "Web", channel: "web" });
      setChatInput("");
    } finally {
      setSending(false);
    }
  }, [chatInput, conversationFilter, sending]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSend();
    }
  };

  const teamGroups = useMemo(() => buildTeamGroups(agents, teams), [agents, teams]);
  const agentEntries = useMemo(() => (agents ? Object.entries(agents) : []), [agents]);

  const loungeModel = useMemo<SceneLounge>(
    () => ({
      label: "Agent Lounge",
      agentCount: agentEntries.length,
      teamCount: teamGroups.length,
    }),
    [agentEntries.length, teamGroups.length],
  );

  const homePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; color: string; groupLabel: string }>();
    const orderedAgents = teamGroups.flatMap((group) => group.memberIds.map((agentId) => ({ agentId, group })));
    orderedAgents.forEach(({ agentId, group }, memberIndex) => {
        positions.set(agentId, {
          ...getLoungeMemberSpot(memberIndex, orderedAgents.length),
          color: group.color,
          groupLabel: group.label,
        });
    });
    return positions;
  }, [teamGroups]);

  const latestUserBubble = useMemo(
    () => [...bubbles].reverse().find((bubble) => bubble.agentId.startsWith("_user_")),
    [bubbles],
  );

  const latestAgentBubbleById = useMemo(() => {
    const lookup = new Map<string, LiveBubble>();
    bubbles.forEach((bubble) => {
      if (bubble.agentId.startsWith("_user_")) return;
      const existing = lookup.get(bubble.agentId);
      if (!existing || existing.timestamp < bubble.timestamp) lookup.set(bubble.agentId, bubble);
    });
    return lookup;
  }, [bubbles]);

  const latestRelevantBubbleByAgent = useMemo(() => {
    const lookup = new Map<string, LiveBubble>();
    bubbles.forEach((bubble) => {
      const relatedAgentIds = new Set<string>();
      if (!bubble.agentId.startsWith("_user_")) relatedAgentIds.add(bubble.agentId);
      bubble.targetAgents.forEach((agentId) => relatedAgentIds.add(agentId));

      relatedAgentIds.forEach((agentId) => {
        const existing = lookup.get(agentId);
        if (!existing || existing.timestamp < bubble.timestamp) {
          lookup.set(agentId, bubble);
        }
      });
    });
    return lookup;
  }, [bubbles]);

  const latestResponseByAgent = useMemo(() => {
    const lookup = new Map<string, ResponseData>();
    (responses ?? []).forEach((response) => {
      if (!response.agent) return;
      const existing = lookup.get(response.agent);
      if (!existing || existing.timestamp < response.timestamp) {
        lookup.set(response.agent, response);
      }
    });
    return lookup;
  }, [responses]);

  const activeTasks = useMemo(() => {
    const allTasks = tasks ?? [];
    return allTasks
      .filter((task) => task.status === "in_progress" || task.status === "review")
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [tasks]);

  const taskStations = useMemo<SceneTaskStation[]>(() => {
    return agentEntries.map(([agentId, agent]) => {
      const directTask = activeTasks.find(
        (task) => task.assigneeType === "agent" && task.assignee === agentId,
      );
      const teamTask = activeTasks.find((task) => {
        if (task.assigneeType !== "team" || !task.assignee) return false;
        const team = teams?.[task.assignee];
        return Boolean(team?.agents.includes(agentId));
      });
      const activeTask = directTask ?? teamTask;
      const recentRouteBubble = [...bubbles]
        .filter(
          (bubble) =>
            clock.now - bubble.timestamp < 120000 &&
            (bubble.agentId === agentId || bubble.targetAgents.includes(agentId)),
        )
        .sort((left, right) => right.timestamp - left.timestamp)[0];

      if (activeTask) {
        return {
          id: `desk-${agentId}`,
          label: agent.name,
          subtitle: trimText(activeTask.title, 42),
          status: taskTone(activeTask),
          kind: "task" as const,
        };
      }

      if (recentRouteBubble) {
        return {
          id: `desk-${agentId}`,
          label: agent.name,
          subtitle: trimText(recentRouteBubble.message, 42),
          status: routeTone(recentRouteBubble.message),
          kind: "route" as const,
        };
      }

      return {
        id: `desk-${agentId}`,
        label: agent.name,
        subtitle: `@${agentId} waiting in lounge`,
        status: "empty" as const,
        kind: "task" as const,
      };
    });
  }, [activeTasks, agentEntries, bubbles, clock.now, teams]);

  const stationAssignments = useMemo(() => {
    const assignments = new Map<string, StationAssignment>();

    activeTasks.forEach((task, stationIndex) => {
      let assignedAgentIds: string[] = [];
      if (task.assigneeType === "team" && task.assignee) {
        const team = teams?.[task.assignee];
        assignedAgentIds = team ? team.agents.filter((agentId) => agents?.[agentId]).slice(0, 3) : [];
        if (team?.leader_agent && assignedAgentIds.includes(team.leader_agent)) {
          assignedAgentIds = [team.leader_agent, ...assignedAgentIds.filter((agentId) => agentId !== team.leader_agent)];
        }
      } else if (task.assigneeType === "agent" && task.assignee && agents?.[task.assignee]) {
        assignedAgentIds = [task.assignee];
      }

      assignedAgentIds.forEach((agentId, memberIndex) => {
        if (!assignments.has(agentId)) {
          const agentDeskIndex = agentEntries.findIndex(([id]) => id === agentId);
          assignments.set(agentId, {
            stationIndex: agentDeskIndex >= 0 ? agentDeskIndex : stationIndex,
            kind: "task",
            status: taskTone(task),
            startAt: task.updatedAt,
            responseAt:
              latestResponseByAgent.get(agentId) && latestResponseByAgent.get(agentId)!.timestamp >= task.updatedAt
                ? latestResponseByAgent.get(agentId)!.timestamp
                : undefined,
            label: task.title,
            speaker: memberIndex === 0,
          });
        }
      });
    });

    agentEntries.forEach(([agentId], index) => {
      if (assignments.has(agentId)) return;

      const session = agentWorkSessions[agentId];
      if (!session) return;
      if (session.completedAt && clock.now - session.completedAt > AGENT_SESSION_RELEASE_MS) return;
      const relevantBubble = latestRelevantBubbleByAgent.get(agentId);

      assignments.set(agentId, {
        stationIndex: index,
        kind: "route",
        status: routeTone(relevantBubble?.message ?? "working"),
        startAt: session.startedAt,
        responseAt: session.completedAt,
        label: trimText(relevantBubble?.message ?? "working", 30),
        speaker: true,
      });
    });

    return assignments;
  }, [activeTasks, latestRelevantBubbleByAgent, clock.now, agents, teams, agentEntries, agentWorkSessions]);

  const sceneAgents = useMemo<SceneAgent[]>(() => {
    return agentEntries.map(([agentId], index) => {
      const home = homePositions.get(agentId) ?? {
        x: 100 + index * 40,
        y: 620,
        color: AGENT_COLORS[index % AGENT_COLORS.length],
        groupLabel: "Independent",
      };
      const assignment = stationAssignments.get(agentId);
      const latestBubble = latestAgentBubbleById.get(agentId);
      const errorActive = latestBubble && clock.now - latestBubble.timestamp < 8000 && isErrorMessage(latestBubble.message);

      let target = { x: home.x, y: home.y };
      let anim: SceneAgent["anim"] = index % 2 === 0 ? "idle" : "sleep";

      if (assignment) {
        const stationSpot = getTaskStationMemberSpot(
          assignment.stationIndex,
          Math.max(1, taskStations.length),
          0,
          1,
        );
        if (assignment.kind === "route") {
          if (!assignment.responseAt) {
            const age = clock.now - assignment.startAt;
            const arriveProgress = clamp(age / 1200, 0, 1);
            target = interpolatePoint(home, stationSpot, easeInOut(arriveProgress));
            anim = age < 1200 ? "walk" : assignment.speaker ? "type" : "idle";
          } else {
            const replyAge = clock.now - assignment.responseAt;
            const holdDuration = 5000;
            if (replyAge < holdDuration) {
              target = stationSpot;
              anim = "idle";
            } else {
              const returnProgress = clamp((replyAge - holdDuration) / 1200, 0, 1);
              target = interpolatePoint(stationSpot, home, easeInOut(returnProgress));
              anim = returnProgress < 1 ? "walk" : index % 2 === 0 ? "idle" : "sleep";
            }
          }
        } else {
          target = stationSpot;
          if (assignment.responseAt) {
            const replyAge = clock.now - assignment.responseAt;
            const holdDuration = 5000;
            if (replyAge < holdDuration) {
              target = stationSpot;
              anim = "idle";
            } else {
              const returnProgress = clamp((replyAge - holdDuration) / 1200, 0, 1);
              target = interpolatePoint(stationSpot, home, easeInOut(returnProgress));
              anim = returnProgress < 1 ? "walk" : index % 2 === 0 ? "idle" : "sleep";
            }
          } else {
            anim = assignment.status === "pending" ? "idle" : assignment.speaker ? "type" : "idle";
          }
        }
      }

      if (errorActive) {
        anim = "error";
      }

      return {
        id: agentId,
        label: agentId,
        color: home.color,
        x: target.x,
        y: target.y,
        anim,
        flip: target.x < home.x,
      };
    });
  }, [agentEntries, clock.now, homePositions, latestAgentBubbleById, stationAssignments, taskStations.length]);

  const taskSummaries = useMemo<SceneTaskSummary[]>(() => {
    const allTasks = tasks ?? [];
    return [
      { label: "backlog", count: allTasks.filter((task) => task.status === "backlog").length, tone: "empty" },
      { label: "active", count: allTasks.filter((task) => task.status === "in_progress").length, tone: "running" },
      { label: "review", count: allTasks.filter((task) => task.status === "review").length, tone: "pending" },
      { label: "done", count: allTasks.filter((task) => task.status === "done").length, tone: "done" },
    ];
  }, [tasks]);

  const queueSnapshot = useMemo<SceneQueueSnapshot>(
    () => ({
      incoming: queueStatus?.incoming ?? 0,
      processing: queueStatus?.processing ?? 0,
      outgoing: queueStatus?.outgoing ?? 0,
      activeConversations: queueStatus?.activeConversations ?? 0,
    }),
    [queueStatus],
  );

  const responseItems = useMemo<SceneResponseItem[]>(
    () =>
      (responses ?? []).map((response) => ({
        id: response.messageId,
        label: trimText(response.message, 40),
        subtitle: responseSubtitle(response),
        tone: responseTone(response),
      })),
    [responses],
  );

  const routeRoot = latestUserBubble
    ? trimText(latestUserBubble.message, 20)
    : activeTasks[0]
      ? trimText(activeTasks[0].title, 20)
      : "no active route";

  const routeTargets = useMemo<SceneRouteTarget[]>(() => {
    if (latestUserBubble) {
      return latestUserBubble.targetAgents
        .slice(0, 3)
        .map((agentId) => {
          const agent = sceneAgents.find((entry) => entry.id === agentId);
          return {
            label: agentId,
            color: agent?.color ?? AGENT_COLORS[0],
            state: stationAssignments.get(agentId)?.status ?? "pending",
          };
        });
    }

    return activeTasks
      .slice(0, 3)
      .map((task) => ({
        label: task.assignee || "unassigned",
        color: AGENT_COLORS[0],
        state: taskTone(task),
      }));
  }, [activeTasks, latestUserBubble, sceneAgents, stationAssignments]);

  const bossRoomModel = useMemo<SceneBossRoom>(
    () => ({
      label: "Boss Room",
      subtitle: "the human issues commands from here",
      commandText: latestUserBubble ? trimText(latestUserBubble.message, 42) : "Message @agent or @team to dispatch work",
      commandTargets: latestUserBubble?.targetAgents.slice(0, 3) ?? [],
      connected,
    }),
    [connected, latestUserBubble],
  );

  const archiveRoomModel = useMemo<SceneArchiveRoom>(() => ({ label: "Archives" }), []);

  const activeWorkers = sceneAgents.filter((agent) => agent.anim === "type" || agent.anim === "walk").length;
  const statusLabel = sending
    ? "dispatching new message"
    : queueSnapshot.processing > 0
      ? `${queueSnapshot.processing} chains running · ${activeWorkers} agents in motion`
      : activeTasks.length > 0
        ? `${activeTasks.length} active tasks on the floor`
        : connected
          ? "floor is live and waiting"
          : "waiting for live event stream";

  const overlayBubbles = useMemo<OverlayBubble[]>(() => {
    const items: OverlayBubble[] = [];

    if (latestUserBubble && clock.now - latestUserBubble.timestamp < 10000) {
      items.push({
        id: latestUserBubble.id,
        x: PIXEL_SCENE_LAYOUT.bossRoomX + 108,
        y: PIXEL_SCENE_LAYOUT.bossRoomY + 140,
        color: "#84cc16",
        heading: "boss command",
        message: trimText(latestUserBubble.message, 220),
      });
    }

    latestAgentBubbleById.forEach((bubble, agentId) => {
      if (clock.now - bubble.timestamp > 9000) return;
      const agent = sceneAgents.find((entry) => entry.id === agentId);
      if (!agent) return;
      items.push({
        id: bubble.id,
        x: agent.x,
        y: agent.y - 82,
        color: agent.color,
        heading: "agent update",
        message: trimText(bubble.message, 220),
      });
    });

    return items;
  }, [clock.now, latestAgentBubbleById, latestUserBubble, sceneAgents]);

  const conversationEntries = useMemo<ConversationEntry[]>(
    () => {
      const historyEntries: ConversationEntry[] = [];
      const seenHistory = new Set<string>();

      Object.entries(agentHistories ?? {}).forEach(([agentId, messages]) => {
        messages.forEach((message, index) => {
          const dedupeKey =
            message.role === "user"
              ? `user:${message.message_id || message.id}:${message.content}`
              : `agent:${agentId}:${message.message_id || message.id}:${message.content}`;
          if (seenHistory.has(dedupeKey)) return;
          seenHistory.add(dedupeKey);

          historyEntries.push({
            id: `history-${agentId}-${message.id}`,
            timestamp: message.created_at,
            role: message.role === "user" ? "user" : "agent",
            agentId: message.role === "assistant" ? agentId : undefined,
            sender: message.role === "user" ? message.sender || "Boss" : agents?.[agentId]?.name || `@${agentId}`,
            message: message.content,
            targetAgents: message.role === "user" ? [agentId] : [],
            sourceOrder: index,
          });
        });
      });

      const liveEntries = [...bubbles].map((bubble, index) => {
        if (bubble.agentId.startsWith("_user_")) {
          return {
            id: bubble.id,
            timestamp: bubble.timestamp,
            role: "user" as const,
            sender: "Boss",
            message: bubble.message,
            targetAgents: bubble.targetAgents,
            sourceOrder: index,
          };
        }

        const agent = agents?.[bubble.agentId];
        return {
          id: bubble.id,
          timestamp: bubble.timestamp,
          role: "agent" as const,
          agentId: bubble.agentId,
          sender: agent?.name || `@${bubble.agentId}`,
          message: bubble.message,
          targetAgents: bubble.targetAgents,
          sourceOrder: index,
        };
      });

      const merged = [...historyEntries, ...liveEntries];
      const seen = new Set<string>();
      return merged
        .sort((left, right) => {
          if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
          if (left.role !== right.role) return left.role === "user" ? -1 : 1;
          return left.sourceOrder - right.sourceOrder;
        })
        .filter((entry) => {
          const key = `${entry.role}:${entry.agentId || "boss"}:${entry.timestamp}:${entry.message}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    },
    [agentHistories, agents, bubbles],
  );

  const visibleConversation = useMemo(() => {
    if (conversationFilter === "all") return conversationEntries.slice(-60);
    return conversationEntries
      .filter((entry) => {
        if (entry.role === "agent") return entry.agentId === conversationFilter;
        return entry.targetAgents.length === 0 || entry.targetAgents.includes(conversationFilter);
      })
      .slice(-60);
  }, [conversationEntries, conversationFilter]);

  useEffect(() => {
    const node = conversationScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [visibleConversation]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden border-b border-border bg-[radial-gradient(circle_at_top,#1b2440,#0c0a09_58%)] p-3">
        <div className="relative size-full">
          <PixelOfficeScene
            frame={clock.frame}
            connected={connected}
            statusLabel={statusLabel}
            queue={queueSnapshot}
            bossRoom={bossRoomModel}
            archiveRoom={archiveRoomModel}
            routeRoot={routeRoot}
            routeTargets={routeTargets}
            lounge={loungeModel}
            taskStations={taskStations}
            taskSummaries={taskSummaries}
            responses={responseItems}
            agents={sceneAgents}
          />

          <div
            className="absolute grid grid-cols-2 gap-[0.45vw] min-[1280px]:gap-2.5"
            style={{
              left: `${((PIXEL_SCENE_LAYOUT.archiveRoomX + 41) / PIXEL_SCENE_LAYOUT.width) * 100}%`,
              top: `${((PIXEL_SCENE_LAYOUT.archiveRoomY + 166) / PIXEL_SCENE_LAYOUT.height) * 100}%`,
              width: `${(148 / PIXEL_SCENE_LAYOUT.width) * 100}%`,
            }}
          >
            {[
              { id: "logs", label: "Logs" },
              { id: "workspace", label: "Workspace" },
              { id: "tasks", label: "Task Board" },
              { id: "outgoing", label: "Outgoing Dock" },
              { id: "routing", label: "Live Routing" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setArchivePanel((current) => (current === item.id ? null : (item.id as typeof archivePanel)))}
                className={`min-w-0 justify-self-stretch rounded-[10px] border border-stone-700 bg-[rgba(37,28,24,0.88)] px-[0.45vw] py-[0.3vw] text-[clamp(7px,0.6vw,10px)] leading-none font-mono text-stone-100 transition hover:border-lime-500 hover:text-lime-300 min-[1280px]:px-2.5 min-[1280px]:py-[4px] ${
                  item.id === "routing" ? "col-span-2" : ""
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {archivePanel && (
            <div className="absolute inset-y-6 right-4 z-30 w-[380px] rounded-md border border-stone-700 bg-stone-950/95 shadow-2xl">
              <div className="flex items-center justify-between border-b border-stone-800 px-4 py-3">
                <div className="font-mono text-xs uppercase tracking-[0.18em] text-lime-300">
                  {archivePanel === "logs" && "Logs"}
                  {archivePanel === "workspace" && "Workspace"}
                  {archivePanel === "tasks" && "Task Board"}
                  {archivePanel === "outgoing" && "Outgoing Dock"}
                  {archivePanel === "routing" && "Live Routing"}
                </div>
                <button
                  type="button"
                  onClick={() => setArchivePanel(null)}
                  className="rounded border border-stone-700 px-2 py-1 font-mono text-[10px] text-stone-300 transition hover:border-lime-500 hover:text-lime-300"
                >
                  Close
                </button>
              </div>
              <div className="max-h-[calc(100%-52px)] overflow-auto p-4">
                {archivePanel === "logs" && (
                  <div className="space-y-2 font-mono text-xs text-stone-300">
                    {(logs?.lines ?? []).length > 0 ? (
                      (logs?.lines ?? []).map((line, index) => (
                        <div key={`${index}-${line.slice(0, 12)}`} className="rounded border border-stone-800 bg-stone-900/90 px-3 py-2 break-words">
                          {line}
                        </div>
                      ))
                    ) : (
                      <div className="rounded border border-stone-800 bg-stone-900/90 px-3 py-2 text-stone-500">No logs yet</div>
                    )}
                  </div>
                )}

                {archivePanel === "workspace" && (
                  <div className="space-y-3 font-mono text-xs text-stone-300">
                    <div className="rounded border border-stone-800 bg-stone-900/90 px-3 py-2">
                      workspace: {settings?.workspace?.path || settings?.workspace?.name || "not configured"}
                    </div>
                    {agentEntries.map(([agentId, agent]) => (
                      <div key={agentId} className="rounded border border-stone-800 bg-stone-900/90 px-3 py-2">
                        <div className="text-lime-300">@{agentId}</div>
                        <div className="mt-1 break-all text-stone-400">{agent.working_directory || "no working directory"}</div>
                      </div>
                    ))}
                  </div>
                )}

                {archivePanel === "tasks" && (
                  <div className="grid grid-cols-2 gap-3 font-mono text-xs text-stone-300">
                    {taskSummaries.map((summary) => (
                      <div key={summary.label} className="rounded border border-stone-800 bg-stone-900/90 px-3 py-3">
                        <div className="text-stone-500">{summary.label}</div>
                        <div className="mt-2 text-xl text-lime-300">{summary.count}</div>
                      </div>
                    ))}
                  </div>
                )}

                {archivePanel === "outgoing" && (
                  <div className="space-y-2 font-mono text-xs text-stone-300">
                    {responseItems.length > 0 ? (
                      responseItems.map((response) => (
                        <div key={response.id} className="rounded border border-stone-800 bg-stone-900/90 px-3 py-2">
                          <div className="text-lime-300">{response.label}</div>
                          <div className="mt-1 text-stone-500">{response.subtitle}</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded border border-stone-800 bg-stone-900/90 px-3 py-2 text-stone-500">No outgoing responses</div>
                    )}
                  </div>
                )}

                {archivePanel === "routing" && (
                  <div className="space-y-3 font-mono text-xs text-stone-300">
                    <div className="rounded border border-stone-800 bg-stone-900/90 px-3 py-2">
                      <div className="text-stone-500">root</div>
                      <div className="mt-1 text-lime-300">{routeRoot}</div>
                    </div>
                    {routeTargets.length > 0 ? (
                      routeTargets.map((target) => (
                        <div key={`${target.label}-${target.state}`} className="rounded border border-stone-800 bg-stone-900/90 px-3 py-2">
                          <div style={{ color: target.color }}>{target.label}</div>
                          <div className="mt-1 text-stone-500">{target.state}</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded border border-stone-800 bg-stone-900/90 px-3 py-2 text-stone-500">No active route</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div
            className="absolute z-10 flex flex-col overflow-hidden rounded-[18px] border border-[#7b6555] bg-[rgba(182,151,122,0.92)] shadow-2xl"
            style={{
              left: `${(680 / PIXEL_SCENE_LAYOUT.width) * 100}%`,
              top: `${(26 / PIXEL_SCENE_LAYOUT.height) * 100}%`,
              width: `${(560 / PIXEL_SCENE_LAYOUT.width) * 100}%`,
              height: `${(668 / PIXEL_SCENE_LAYOUT.height) * 100}%`,
            }}
          >
            <div className="border-b border-[#8e755f] bg-[rgba(120,95,75,0.42)] px-4 py-3">
              <div className="mb-3 inline-flex h-[18px] items-center rounded-[4px] border border-[#84cc16] bg-[#1c1917] px-3 text-[12px] font-mono text-[#84cc16] shadow-[0_0_0_1px_#84cc16]">
                Conversations
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConversationFilter("all")}
                  className={`rounded-[10px] border px-3 py-1.5 font-mono text-[10px] transition ${
                    conversationFilter === "all"
                      ? "border-[#84cc16] bg-[rgba(132,204,22,0.14)] text-[#2f4d0d]"
                      : "border-[#826b58] bg-[rgba(244,231,214,0.46)] text-[#5e4b3d] hover:border-[#84cc16] hover:text-[#2f4d0d]"
                  }`}
                >
                  All Agents
                </button>
                {agentEntries.map(([agentId, agent]) => (
                  <button
                    key={agentId}
                    type="button"
                    onClick={() => setConversationFilter(agentId)}
                    className={`rounded-[10px] border px-3 py-1.5 font-mono text-[10px] transition ${
                      conversationFilter === agentId
                        ? "border-[#84cc16] bg-[rgba(132,204,22,0.14)] text-[#2f4d0d]"
                        : "border-[#826b58] bg-[rgba(244,231,214,0.46)] text-[#5e4b3d] hover:border-[#84cc16] hover:text-[#2f4d0d]"
                    }`}
                  >
                    {agent.name || `@${agentId}`}
                  </button>
                ))}
              </div>
            </div>

            <div
              ref={conversationScrollRef}
              className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(199,171,143,0.92),rgba(176,146,119,0.88))] px-4 py-4"
            >
              <div className="space-y-3">
                {visibleConversation.length > 0 ? (
                  visibleConversation.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded-[14px] border px-3.5 py-2.5 shadow-[0_1px_0_rgba(76,60,48,0.16)] ${
                        entry.role === "user"
                          ? "ml-12 border-[#84cc16] bg-[rgba(235,248,196,0.78)]"
                          : "mr-12 border-[#8b7460] bg-[rgba(243,229,211,0.72)]"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${entry.role === "user" ? "text-[#45680f]" : "text-[#6d5948]"}`}>
                          {entry.sender}
                        </span>
                        <span className="font-mono text-[10px] text-[#7f6a57]">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="break-words text-sm leading-relaxed text-[#231b16]">{entry.message}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[14px] border border-dashed border-[#8b7460] bg-[rgba(244,231,214,0.45)] px-4 py-6 text-center text-sm text-[#6f5c4b]">
                    No messages for this view
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-[#8e755f] bg-[rgba(120,95,75,0.36)] px-4 py-3">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={conversationFilter === "all" ? "Message @agent or @team..." : `Message @${conversationFilter}...`}
                  className="h-10 flex-1 rounded-[12px] border border-[#8b7460] bg-[rgba(244,231,214,0.78)] px-3.5 text-sm text-[#231b16] outline-none transition-colors placeholder:text-[#8a7564] focus:border-[#84cc16]"
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={!chatInput.trim() || sending}
                  className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#8b7460] bg-[rgba(244,231,214,0.78)] text-[#6d5948] transition-colors hover:border-[#84cc16] hover:text-[#45680f] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-[#6f5c4b]">
                <span>Cmd/Ctrl + Enter to send</span>
                <span>
                  {connected ? "SSE online" : "SSE disconnected"} · {taskSummaries[1]?.count ?? 0} active · {queueSnapshot.outgoing} outgoing
                </span>
              </div>
            </div>
          </div>

          {overlayBubbles.map((bubble) => {
            const position = pointToPercent(bubble.x, bubble.y);
            return (
              <div
                key={bubble.id}
                className={`absolute z-20 h-[76px] w-[192px] -translate-x-1/2 animate-slide-up ${
                  bubble.heading === "boss command" ? "" : "-translate-y-full"
                }`}
                style={{ left: position.left, top: position.top }}
              >
                <div
                  className="relative flex h-full w-full flex-col rounded-[12px] border px-2.5 py-2 text-[10px] leading-relaxed text-white shadow-xl"
                  style={{ borderColor: bubble.color, background: "rgba(17, 24, 39, 0.94)" }}
                >
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: bubble.color }}>
                    {bubble.heading}
                  </div>
                  <p className="line-clamp-2 break-words overflow-hidden text-ellipsis">{bubble.message}</p>
                  {bubble.heading === "boss command" ? (
                    <div
                      className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t"
                      style={{ borderColor: bubble.color, background: "rgba(17, 24, 39, 0.94)" }}
                    />
                  ) : (
                    <div
                      className="absolute left-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r border-b"
                      style={{ borderColor: bubble.color, background: "rgba(17, 24, 39, 0.94)" }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
