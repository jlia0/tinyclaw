"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  PixelOfficeScene,
  PIXEL_SCENE_LAYOUT,
  getTaskStationMemberSpot,
  getLoungeMemberSpot,
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

import { ArchivePanel, type ArchivePanelId } from "@/components/office/archive-panel";
import { ConversationPanel } from "@/components/office/conversation-panel";
import { OverlayBubbles } from "@/components/office/overlay-bubbles";
import {
  AGENT_COLORS,
  AGENT_SESSION_RELEASE_MS,
  ARCHIVE_BUTTONS,
  OFFICE_STATION_COUNT,
  buildTeamGroups,
  clamp,
  easeInOut,
  extractTargets,
  interpolatePoint,
  isErrorMessage,
  responseTone,
  responseSubtitle,
  routeTone,
  taskTone,
  trimText,
  type AgentWorkSession,
  type LiveBubble,
  type OverlayBubble,
  type StationAssignment,
} from "@/components/office/types";

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
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState({ now: Date.now(), frame: 0 });
  const [archivePanel, setArchivePanel] = useState<ArchivePanelId | null>(null);
  const [agentWorkSessions, setAgentWorkSessions] = useState<Record<string, AgentWorkSession>>({});

  const seenRef = useRef(new Set<string>());
  const rootSessionsRef = useRef(new Map<string, { startedAt: number; agentIds: Set<string>; completedAt?: number }>());
  const openRootOrderRef = useRef<string[]>([]);

  // ── Clock tick ──────────────────────────────────────────────────────────

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClock((current) => ({ now: Date.now(), frame: current.frame + 1 }));
    }, 120);
    return () => window.clearInterval(interval);
  }, []);

  // ── Work session cleanup ────────────────────────────────────────────────

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

  // ── SSE subscription ───────────────────────────────────────────────────

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

  // ── Bubble expiry ──────────────────────────────────────────────────────

  useEffect(() => {
    const interval = window.setInterval(() => {
      const cutoff = Date.now() - 180000;
      setBubbles((current) => current.filter((bubble) => bubble.timestamp > cutoff));
    }, 2000);
    return () => window.clearInterval(interval);
  }, []);

  // ── Scene data computation ─────────────────────────────────────────────

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
    const stations = agentEntries.map(([agentId, agent]) => {
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
    const renderedStationCount = Math.max(OFFICE_STATION_COUNT, stations.length);
    for (let index = stations.length; index < renderedStationCount; index += 1) {
      stations.push({
        id: `desk-empty-${index}`,
        label: `Open Desk ${index + 1}`,
        subtitle: "vacant workstation",
        status: "empty",
        kind: "task",
      });
    }
    return stations;
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
  }, [activeTasks, latestRelevantBubbleByAgent, latestResponseByAgent, clock.now, agents, teams, agentEntries, agentWorkSessions]);

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

  const overlayBubbles = useMemo<OverlayBubble[]>(() => {
    const items: OverlayBubble[] = [];

    if (latestUserBubble && clock.now - latestUserBubble.timestamp < 10000) {
      items.push({
        id: latestUserBubble.id,
        x: PIXEL_SCENE_LAYOUT.bossRoomX + PIXEL_SCENE_LAYOUT.bossRoomWidth / 2,
        y: PIXEL_SCENE_LAYOUT.bossRoomY + PIXEL_SCENE_LAYOUT.bossRoomHeight - 6,
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

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden bg-[#3b3a37] p-3">
        <div className="relative size-full overflow-hidden border border-[#725844] bg-[linear-gradient(180deg,#ccb294,#b89b7d)] shadow-[0_22px_60px_rgba(28,18,12,0.32)]">
          <PixelOfficeScene
            frame={clock.frame}
            bossRoom={bossRoomModel}
            archiveRoom={archiveRoomModel}
            lounge={loungeModel}
            taskStations={taskStations}
            agents={sceneAgents}
          />

          <div
            className="absolute z-[90] grid grid-cols-2 gap-1.5"
            style={{
              left: `${((PIXEL_SCENE_LAYOUT.archiveRoomX + 36) / PIXEL_SCENE_LAYOUT.width) * 100}%`,
              top: `${((PIXEL_SCENE_LAYOUT.archiveRoomY + 36) / PIXEL_SCENE_LAYOUT.height) * 100}%`,
              width: `${(152 / PIXEL_SCENE_LAYOUT.width) * 100}%`,
            }}
          >
            {ARCHIVE_BUTTONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setArchivePanel((current) => (current === item.id ? null : item.id))}
                className={`flex h-[28px] w-full items-center justify-center border px-2 py-1 text-center font-mono text-[10px] leading-none shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] transition ${
                  archivePanel === item.id
                    ? "border-[#465e14] bg-[#111111] text-[#a3e635]"
                    : "border-[#885c47] bg-[#dcc3a3] text-[#5c4637] hover:border-[#465e14] hover:bg-[#111111] hover:text-[#a3e635]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {archivePanel && (
            <ArchivePanel
              panel={archivePanel}
              onClose={() => setArchivePanel(null)}
              logs={logs}
              settings={settings}
              agentEntries={agentEntries}
              taskSummaries={taskSummaries}
              responseItems={responseItems}
              routeRoot={routeRoot}
              routeTargets={routeTargets}
            />
          )}

          <ConversationPanel
            agents={agents}
            agentEntries={agentEntries}
            agentHistories={agentHistories}
            bubbles={bubbles}
          />

          <OverlayBubbles bubbles={overlayBubbles} />
        </div>
      </div>
    </div>
  );
}
