"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { usePolling } from "@/lib/hooks";
import { timeAgo } from "@/lib/hooks";
import {
  getAgents,
  getTeams,
  subscribeToEvents,
  type AgentConfig,
  type TeamConfig,
  type EventData,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";

// Sprite keys cycle for agents beyond the 3 built-in chars
const SPRITE_KEYS = ["char_1", "char_2", "char_3", "char_player"];

// Desk positions in the office grid (normalized 0-1 coordinates)
const DESK_POSITIONS = [
  { x: 0.14, y: 0.21 },
  { x: 0.25, y: 0.21 },
  { x: 0.36, y: 0.21 },
  { x: 0.47, y: 0.21 },
  { x: 0.14, y: 0.36 },
  { x: 0.25, y: 0.36 },
  { x: 0.36, y: 0.36 },
  { x: 0.47, y: 0.36 },
  { x: 0.61, y: 0.63 },
  { x: 0.72, y: 0.63 },
  { x: 0.83, y: 0.63 },
  { x: 0.61, y: 0.78 },
  { x: 0.72, y: 0.78 },
  { x: 0.83, y: 0.78 },
];

// Meeting point offset so two agents don't overlap
const MEETING_OFFSET = 0.03;

interface SpeechBubble {
  id: string;
  agentId: string;
  message: string;
  timestamp: number;
  targetAgents: string[];
}

interface StatusEvent {
  id: string;
  type: string;
  agentId?: string;
  timestamp: number;
  detail?: string;
}

// Extract all @mention targets from message text
function extractTargets(msg: string): string[] {
  const targets: string[] = [];
  // Match all [@agent: ...] blocks
  const bracketMatches = msg.matchAll(/\[@(\w[\w-]*?):/g);
  for (const m of bracketMatches) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }
  // Fallback: bare @agent at start
  if (targets.length === 0) {
    const atMatch = msg.match(/^@(\w[\w-]*)/);
    if (atMatch) targets.push(atMatch[1]);
  }
  return targets;
}

// Parse message into segments: plain text and [@agent: message] blocks
interface MsgSegment {
  type: "mention" | "text";
  agent?: string;
  text: string;
}

function parseMessage(msg: string): MsgSegment[] {
  const segments: MsgSegment[] = [];
  // Match [@agent: content] blocks
  const regex = /\[@(\w[\w-]*?):\s*(.*?)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(msg)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      const before = msg.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "text", text: before });
    }
    segments.push({ type: "mention", agent: match[1], text: match[2] });
    lastIndex = regex.lastIndex;
  }

  // Remaining text after last match
  if (lastIndex < msg.length) {
    const remaining = msg.slice(lastIndex).trim();
    if (remaining) segments.push({ type: "text", text: remaining });
  }

  // If no brackets found, just return the whole message
  if (segments.length === 0) {
    segments.push({ type: "text", text: msg });
  }

  return segments;
}

// Lerp between two values
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function OfficePage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const [bubbles, setBubbles] = useState<SpeechBubble[]>([]);
  const [statusEvents, setStatusEvents] = useState<StatusEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seenRef = useRef(new Set<string>());

  const agentEntries = agents ? Object.entries(agents) : [];
  const teamEntries = teams ? Object.entries(teams) : [];

  // Assign agents to desk positions and sprite images
  const agentPositions = useMemo(
    () =>
      agentEntries.map(([id, agent], i) => ({
        id,
        agent,
        deskPos: DESK_POSITIONS[i % DESK_POSITIONS.length],
        sprite: `/assets/office/${SPRITE_KEYS[i % SPRITE_KEYS.length]}.png`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentEntries.map(([id]) => id).join(",")]
  );

  // Build desk position lookup
  const deskPosMap = useMemo(
    () => new Map(agentPositions.map((a) => [a.id, a.deskPos])),
    [agentPositions]
  );

  // Compute where each agent currently is: at desk or walking to meet someone
  const agentRenderPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();

    // Start everyone at their desk
    for (const ap of agentPositions) {
      positions.set(ap.id, { x: ap.deskPos.x, y: ap.deskPos.y + 0.06 });
    }

    // For each active bubble with targets, move agents toward each other
    // Find the most recent bubble per agent
    const latestBubblePerAgent = new Map<string, SpeechBubble>();
    for (const b of bubbles) {
      const firstTarget = b.targetAgents[0];
      if (firstTarget && deskPosMap.has(b.agentId) && deskPosMap.has(firstTarget)) {
        const existing = latestBubblePerAgent.get(b.agentId);
        if (!existing || b.timestamp > existing.timestamp) {
          latestBubblePerAgent.set(b.agentId, b);
        }
      }
    }

    // Move agents toward each other (use first target for position)
    for (const [agentId, bubble] of latestBubblePerAgent) {
      const firstTarget = bubble.targetAgents[0]!;
      const fromDesk = deskPosMap.get(agentId)!;
      const toDesk = deskPosMap.get(firstTarget)!;

      const midX = (fromDesk.x + toDesk.x) / 2;
      const midY = (fromDesk.y + toDesk.y) / 2 + 0.06;

      const dx = toDesk.x - fromDesk.x;
      const dy = toDesk.y - fromDesk.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;

      positions.set(agentId, {
        x: midX - nx * MEETING_OFFSET,
        y: midY - ny * MEETING_OFFSET,
      });

      // Also nudge all targeted agents toward midpoint if not already speaking
      for (const targetId of bubble.targetAgents) {
        if (!latestBubblePerAgent.has(targetId) && deskPosMap.has(targetId)) {
          const tDesk = deskPosMap.get(targetId)!;
          const tdx = tDesk.x - fromDesk.x;
          const tdy = tDesk.y - fromDesk.y;
          const tdist = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
          positions.set(targetId, {
            x: (fromDesk.x + tDesk.x) / 2 + (tdx / tdist) * MEETING_OFFSET,
            y: (fromDesk.y + tDesk.y) / 2 + 0.06 + (tdy / tdist) * MEETING_OFFSET,
          });
        }
      }
    }

    return positions;
  }, [agentPositions, bubbles, deskPosMap]);

  // Subscribe to SSE events
  useEffect(() => {
    const unsub = subscribeToEvents(
      (event: EventData) => {
        setConnected(true);
        const fp = `${event.type}:${event.timestamp}:${(event as Record<string, unknown>).messageId ?? ""}:${(event as Record<string, unknown>).agentId ?? ""}`;
        if (seenRef.current.has(fp)) return;
        seenRef.current.add(fp);
        if (seenRef.current.size > 500) {
          const entries = [...seenRef.current];
          seenRef.current = new Set(entries.slice(entries.length - 300));
        }

        const e = event as Record<string, unknown>;
        const agentId = e.agentId ? String(e.agentId) : undefined;

        // Events that produce speech bubbles (agent actually says something)
        if (
          event.type === "chain_step_done" ||
          event.type === "response_ready"
        ) {
          const msg =
            (e.responseText as string) ||
            (e.message as string) ||
            "";
          if (msg && agentId) {
            const targets = extractTargets(msg);
            const bubble: SpeechBubble = {
              id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
              agentId,
              message: msg,
              timestamp: event.timestamp,
              targetAgents: targets,
            };
            setBubbles((prev) => [...prev, bubble].slice(-50));
          }
        }

        // Events that produce a sent message bubble
        if (event.type === "message_received") {
          const msg = (e.message as string) || "";
          const sender = (e.sender as string) || "User";
          if (msg) {
            const targets = extractTargets(msg);
            const bubble: SpeechBubble = {
              id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
              agentId: `_user_${sender}`,
              message: msg,
              timestamp: event.timestamp,
              targetAgents: targets,
            };
            setBubbles((prev) => [...prev, bubble].slice(-50));
          }
        }

        // Status bar events (chain mechanics)
        const statusTypes = [
          "agent_routed",
          "chain_step_start",
          "chain_handoff",
          "team_chain_start",
          "team_chain_end",
          "message_enqueued",
          "processor_start",
        ];
        if (statusTypes.includes(event.type)) {
          setStatusEvents((prev) =>
            [
              {
                id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
                type: event.type,
                agentId,
                timestamp: event.timestamp,
                detail: (e.message as string) || (e.teamId ? `team:${e.teamId}` : undefined),
              },
              ...prev,
            ].slice(0, 20)
          );
        }
      },
      () => setConnected(false)
    );
    return unsub;
  }, []);

  // Auto-expire old bubbles after 15s
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 15000;
      setBubbles((prev) => prev.filter((b) => b.timestamp > cutoff));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Office</span>
          <Badge variant="outline" className="text-xs">
            {agentEntries.length} agent{agentEntries.length !== 1 ? "s" : ""}
          </Badge>
          {teamEntries.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {teamEntries.length} team{teamEntries.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`h-1.5 w-1.5 ${connected ? "bg-primary animate-pulse-dot" : "bg-destructive"}`}
          />
          <span className="text-[10px] text-muted-foreground">
            {connected ? "Live" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Office Scene */}
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0">
          {/* Floor tiles */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: "url(/assets/office/floor_tile.png)",
              backgroundSize: "40px 40px",
              backgroundRepeat: "repeat",
              imageRendering: "pixelated",
            }}
          />

          {/* Desk clusters (always at desk positions) */}
          {agentPositions.map(({ id, deskPos }) => (
            <div
              key={`desk-${id}`}
              className="absolute"
              style={{
                left: `${deskPos.x * 100}%`,
                top: `${deskPos.y * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <img
                src="/assets/office/desk.png"
                alt=""
                className="w-[72px] h-[40px]"
                style={{ imageRendering: "pixelated" }}
                draggable={false}
              />
              <img
                src="/assets/office/monitor.png"
                alt=""
                className="absolute w-[28px] h-auto"
                style={{
                  top: "-14px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  imageRendering: "pixelated",
                }}
                draggable={false}
              />
              <img
                src="/assets/office/chair.png"
                alt=""
                className="absolute w-[24px] h-auto"
                style={{
                  bottom: "-22px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  imageRendering: "pixelated",
                }}
                draggable={false}
              />
            </div>
          ))}

          {/* Decorative plants */}
          {[
            { x: 0.05, y: 0.06 },
            { x: 0.95, y: 0.06 },
            { x: 0.05, y: 0.9 },
            { x: 0.95, y: 0.9 },
            { x: 0.55, y: 0.5 },
          ].map((pos, i) => (
            <img
              key={`plant-${i}`}
              src="/assets/office/plant.png"
              alt=""
              className="absolute w-[36px] h-auto"
              style={{
                left: `${pos.x * 100}%`,
                top: `${pos.y * 100}%`,
                transform: "translate(-50%, -50%)",
                imageRendering: "pixelated",
              }}
              draggable={false}
            />
          ))}

          {/* Agent characters - positions animate via CSS transition */}
          {agentPositions.map(({ id, agent, sprite }) => {
            const pos = agentRenderPositions.get(id) ?? {
              x: 0.5,
              y: 0.5,
            };
            const activeBubble = bubbles
              .filter((b) => b.agentId === id)
              .slice(-1)[0];

            return (
              <div
                key={`agent-${id}`}
                className="absolute"
                style={{
                  left: `${pos.x * 100}%`,
                  top: `${pos.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: Math.floor(pos.y * 100) + 10,
                  transition: "left 0.8s ease-in-out, top 0.8s ease-in-out",
                }}
              >
                {/* Speech bubble */}
                {activeBubble && (
                  <SpeechBubbleEl bubble={activeBubble} />
                )}

                {/* Character sprite */}
                <img
                  src={sprite}
                  alt={agent.name}
                  className="w-[36px] h-auto mx-auto"
                  style={{ imageRendering: "pixelated" }}
                  draggable={false}
                />

                {/* Agent name label */}
                <div className="text-[9px] text-center font-bold text-foreground mt-0.5 bg-background/80 px-1.5 py-0.5 whitespace-nowrap">
                  @{id}
                </div>
              </div>
            );
          })}

          {/* User avatar in bottom-left */}
          {bubbles.some((b) => b.agentId.startsWith("_user_")) && (
            <div
              className="absolute"
              style={{ left: "8%", bottom: "8%", zIndex: 50 }}
            >
              {(() => {
                const userBubble = bubbles
                  .filter((b) => b.agentId.startsWith("_user_"))
                  .slice(-1)[0];
                return userBubble ? (
                  <>
                    <div className="relative mb-1 max-w-[360px] bg-primary text-primary-foreground text-[11px] px-3 py-2 rounded-sm animate-slide-up shadow-md">
                      <p className="line-clamp-4 break-words">{userBubble.message}</p>
                      <div className="absolute -bottom-1 left-4 w-2 h-2 bg-primary rotate-45" />
                    </div>
                    <img
                      src="/assets/office/char_player.png"
                      alt="User"
                      className="w-[36px] h-auto mx-auto"
                      style={{ imageRendering: "pixelated" }}
                      draggable={false}
                    />
                    <div className="text-[9px] text-center font-bold text-foreground mt-0.5 bg-background/80 px-1.5 py-0.5">
                      You
                    </div>
                  </>
                ) : null;
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Status bar for chain events */}
      <div className="border-t bg-card px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
            Activity
          </span>
          {statusEvents.length === 0 ? (
            <span className="text-[10px] text-muted-foreground/50">No recent activity</span>
          ) : (
            statusEvents.slice(0, 8).map((evt) => (
              <div key={evt.id} className="flex items-center gap-1.5 shrink-0">
                <div className={`h-1.5 w-1.5 shrink-0 ${statusColor(evt.type)}`} />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {evt.type.replace(/_/g, " ")}
                  {evt.agentId ? ` @${evt.agentId}` : ""}
                </span>
                <span className="text-[9px] text-muted-foreground/50">
                  {timeAgo(evt.timestamp)}
                </span>
                <span className="text-muted-foreground/20 mx-0.5">|</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SpeechBubbleEl({ bubble }: { bubble: SpeechBubble }) {
  const segments = parseMessage(bubble.message);

  return (
    <div
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 animate-slide-up"
      style={{ zIndex: 100 }}
    >
      <div className="relative max-w-[400px] min-w-[120px] bg-card border border-border text-[11px] leading-relaxed px-3 py-2 rounded-sm shadow-md">
        <div className="break-words text-foreground space-y-1">
          {segments.map((seg, i) =>
            seg.type === "mention" ? (
              <div key={i}>
                <span className="font-bold text-primary">@{seg.agent}</span>
                <span className="text-muted-foreground">: </span>
                <span>{seg.text.length > 150 ? seg.text.slice(0, 150) + "..." : seg.text}</span>
              </div>
            ) : (
              <span key={i}>
                {seg.text.length > 200 ? seg.text.slice(0, 200) + "..." : seg.text}
              </span>
            )
          )}
        </div>
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-card border-b border-r border-border rotate-45" />
      </div>
    </div>
  );
}

function statusColor(type: string): string {
  switch (type) {
    case "agent_routed":
      return "bg-blue-500";
    case "chain_step_start":
      return "bg-yellow-500";
    case "chain_handoff":
      return "bg-orange-500";
    case "team_chain_start":
      return "bg-purple-500";
    case "team_chain_end":
      return "bg-purple-400";
    case "message_enqueued":
      return "bg-cyan-500";
    case "processor_start":
      return "bg-primary";
    default:
      return "bg-muted-foreground/40";
  }
}
