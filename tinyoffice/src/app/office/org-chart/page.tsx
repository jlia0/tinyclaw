"use client";

import { useMemo, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { usePolling } from "@/lib/hooks";
import {
  getAgents,
  getTeams,
  type AgentConfig,
  type TeamConfig,
} from "@/lib/api";
import { Users, Bot, Crown } from "lucide-react";
import { useRouter } from "next/navigation";

// ── Custom Nodes ──────────────────────────────────────────────────────────

function TeamNode({ data }: NodeProps) {
  return (
    <div className="bg-card border-2 border-primary rounded-lg shadow-lg px-5 py-3 min-w-[160px]">
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />
      <div className="flex items-center gap-2 mb-1">
        <div className="flex h-7 w-7 items-center justify-center bg-primary text-primary-foreground rounded">
          <Users className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">{data.label as string}</div>
          <div className="text-[10px] text-muted-foreground">
            {(data.agentCount as number)} agent{(data.agentCount as number) !== 1 ? "s" : ""}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
    </div>
  );
}

function AgentNode({ data }: NodeProps) {
  const isLeader = data.isLeader as boolean;

  return (
    <div
      className={`bg-card border rounded-lg shadow-md px-4 py-2.5 min-w-[150px] cursor-pointer hover:border-primary transition-colors ${
        isLeader ? "border-primary/60 ring-1 ring-primary/20" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <div
          className={`flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold uppercase shrink-0 ${
            isLeader
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground"
          }`}
        >
          {(data.label as string).slice(0, 2)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-sm font-medium text-foreground truncate">
              {data.label as string}
            </span>
            {isLeader && <Crown className="h-3 w-3 text-primary shrink-0" />}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {data.model as string}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

function UnassignedHeaderNode({ data }: NodeProps) {
  return (
    <div className="bg-card border-2 border-dashed border-muted-foreground/30 rounded-lg shadow px-5 py-3 min-w-[160px]">
      <Handle type="target" position={Position.Top} className="!bg-transparent !w-0 !h-0" />
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center bg-secondary text-secondary-foreground rounded">
          <Bot className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-muted-foreground">{data.label as string}</div>
          <div className="text-[10px] text-muted-foreground">
            {(data.agentCount as number)} agent{(data.agentCount as number) !== 1 ? "s" : ""}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground/30 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  team: TeamNode,
  agent: AgentNode,
  unassignedHeader: UnassignedHeaderNode,
};

// ── Layout helpers ────────────────────────────────────────────────────────

const NODE_W = 180;
const NODE_H = 60;
const H_GAP = 40;
const V_GAP = 100;

function buildOrgChart(
  agents: Record<string, AgentConfig>,
  teams: Record<string, TeamConfig>
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const teamEntries = Object.entries(teams);
  const allAgentIds = Object.keys(agents);

  // Find agents assigned to at least one team
  const assignedAgentIds = new Set<string>();
  for (const [, team] of teamEntries) {
    for (const aid of team.agents) assignedAgentIds.add(aid);
  }

  // Unassigned agents
  const unassignedAgentIds = allAgentIds.filter((id) => !assignedAgentIds.has(id));

  // Calculate groups: each team is a group, plus unassigned group
  const groups: {
    headerId: string;
    headerType: string;
    headerLabel: string;
    agentCount: number;
    members: {
      id: string;
      agentId: string;
      isLeader: boolean;
      label: string;
      model: string;
    }[];
    teamId?: string;
  }[] = [];

  for (const [teamId, team] of teamEntries) {
    const members = team.agents
      .filter((aid) => agents[aid])
      .map((aid) => ({
        id: `team-${teamId}-agent-${aid}`,
        agentId: aid,
        isLeader: aid === team.leader_agent,
        label: agents[aid].name,
        model: `${agents[aid].provider}/${agents[aid].model}`,
      }));
    // Sort so leader comes first
    members.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));

    groups.push({
      headerId: `team-${teamId}`,
      headerType: "team",
      headerLabel: team.name,
      agentCount: members.length,
      members,
      teamId,
    });
  }

  if (unassignedAgentIds.length > 0) {
    groups.push({
      headerId: "unassigned",
      headerType: "unassignedHeader",
      headerLabel: "Unassigned",
      agentCount: unassignedAgentIds.length,
      members: unassignedAgentIds.map((aid) => ({
        id: `unassigned-agent-${aid}`,
        agentId: aid,
        isLeader: false,
        label: agents[aid].name,
        model: `${agents[aid].provider}/${agents[aid].model}`,
      })),
    });
  }

  // Position groups side by side
  let groupX = 0;

  for (const group of groups) {
    const groupWidth = Math.max(1, group.members.length) * (NODE_W + H_GAP) - H_GAP;

    // Header node centered above members
    const headerX = groupX + groupWidth / 2 - NODE_W / 2;
    nodes.push({
      id: group.headerId,
      type: group.headerType,
      position: { x: headerX, y: 0 },
      data: {
        label: group.headerLabel,
        agentCount: group.agentCount,
        teamId: group.teamId,
      },
    });

    // Member nodes
    group.members.forEach((member, i) => {
      const memberX = groupX + i * (NODE_W + H_GAP);
      const memberY = V_GAP + NODE_H;

      nodes.push({
        id: member.id,
        type: "agent",
        position: { x: memberX, y: memberY },
        data: {
          label: member.label,
          model: member.model,
          isLeader: member.isLeader,
          agentId: member.agentId,
        },
      });

      edges.push({
        id: `${group.headerId}->${member.id}`,
        source: group.headerId,
        target: member.id,
        type: "smoothstep",
        style: { stroke: member.isLeader ? "var(--color-primary)" : "var(--color-border)" },
        animated: member.isLeader,
      });
    });

    groupX += groupWidth + H_GAP * 3;
  }

  return { nodes, edges };
}

// ── Main Component ────────────────────────────────────────────────────────

function OrgChartInner() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const { fitView } = useReactFlow();
  const router = useRouter();

  const { nodes, edges } = useMemo(() => {
    if (!agents) return { nodes: [], edges: [] };
    return buildOrgChart(agents, teams ?? {});
  }, [agents, teams]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "agent") {
        router.push(`/agents/${node.data.agentId}`);
      } else if (node.type === "team" && node.data.teamId) {
        router.push(`/chat/team/${node.data.teamId}`);
      }
    },
    [router]
  );

  // Fit view when data changes
  const onNodesChange = useCallback(() => {
    // Let ReactFlow handle internal changes
  }, []);

  useEffect(() => {
    if (nodes.length === 0) return;
    const frame = requestAnimationFrame(() => {
      fitView({ padding: 0.3, duration: 300 });
    });
    return () => cancelAnimationFrame(frame);
  }, [nodes, edges, fitView]);

  if (!agents) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (Object.keys(agents).length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Bot className="h-8 w-8" />
        <p className="text-sm">No agents configured yet.</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onNodesChange={onNodesChange}
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      className="bg-background"
    >
      <Background gap={20} size={1} className="!bg-background" />
      <Controls
        showInteractive={false}
        className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted"
      />
    </ReactFlow>
  );
}

export default function OrgChartPage() {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <OrgChartInner />
      </ReactFlowProvider>
    </div>
  );
}
