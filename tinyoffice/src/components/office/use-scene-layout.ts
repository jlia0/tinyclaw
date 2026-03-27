"use client";

import { useMemo } from "react";
import {
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
} from "./pixel-office-scene";
import type { AgentConfig, AgentMessage, QueueStatus, ResponseData, Settings, Task, TeamConfig } from "@/lib/api";
import {
  AGENT_COLORS,
  AGENT_SESSION_RELEASE_MS,
  OFFICE_STATION_COUNT,
  buildTeamGroups,
  clamp,
  easeInOut,
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
} from "./types";

export type SceneLayoutInput = {
  agents: Record<string, AgentConfig> | null;
  teams: Record<string, TeamConfig> | null;
  tasks: Task[] | null;
  queueStatus: QueueStatus | null;
  responses: ResponseData[] | null;
  settings: Settings | null;
  logs: { lines: string[] } | null;
  agentHistories: Record<string, AgentMessage[]> | null;
  bubbles: LiveBubble[];
  connected: boolean;
  clock: { now: number; frame: number };
  agentWorkSessions: Record<string, AgentWorkSession>;
};

export function useSceneLayout(input: SceneLayoutInput) {
  const { agents, teams, tasks, queueStatus, responses, bubbles, connected, clock, agentWorkSessions } = input;

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

  return {
    agentEntries,
    loungeModel,
    taskStations,
    sceneAgents,
    taskSummaries,
    queueSnapshot,
    responseItems,
    routeRoot,
    routeTargets,
    bossRoomModel,
    archiveRoomModel,
    overlayBubbles,
    latestUserBubble,
  };
}
