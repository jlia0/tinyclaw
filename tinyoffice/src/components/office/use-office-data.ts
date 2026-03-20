"use client";

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
  type AgentConfig,
  type AgentMessage,
  type QueueStatus,
  type ResponseData,
  type Settings,
  type Task,
  type TeamConfig,
} from "@/lib/api";

export function useOfficeData() {
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

  return { agents, teams, tasks, queueStatus, responses, settings, logs, agentHistories };
}
