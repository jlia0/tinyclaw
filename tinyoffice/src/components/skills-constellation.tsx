"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";

// ── Skill types ──────────────────────────────────────────────────────────────

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

interface ConstellationProps {
  skills: SkillEntry[];
  agentName: string;
  agentInitials: string;
}

// ── Radial layout helpers ────────────────────────────────────────────────────

function layoutRadial(
  count: number,
  cx: number,
  cy: number,
  baseRadius: number
): { x: number; y: number; angle: number; ring: number }[] {
  if (count === 0) return [];

  const positions: { x: number; y: number; angle: number; ring: number }[] = [];

  // For small counts, single ring
  // For larger counts, distribute across multiple rings
  const perRing = Math.min(count, 10);
  const rings = Math.ceil(count / perRing);

  let idx = 0;
  for (let ring = 0; ring < rings && idx < count; ring++) {
    const radius = baseRadius + ring * 90;
    const itemsInRing = Math.min(perRing, count - idx);
    const angleOffset = ring * 0.15; // Slight rotation per ring for visual interest

    for (let i = 0; i < itemsInRing; i++) {
      const angle = angleOffset + (i / itemsInRing) * Math.PI * 2;
      positions.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        angle,
        ring,
      });
      idx++;
    }
  }

  return positions;
}

// ── Constellation component ────────────────────────────────────────────────

export function SkillsConstellation({
  skills,
  agentName,
  agentInitials,
}: ConstellationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ w: 900, h: 560 });
  const [hoveredSkill, setHoveredSkill] = useState<string | null>(null);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([e]) => {
      setDimensions({ w: e.contentRect.width, h: e.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const cx = dimensions.w / 2;
  const cy = dimensions.h / 2;
  const baseRadius = Math.min(dimensions.w, dimensions.h) * 0.28;

  // Compute radial positions
  const positions = useMemo(
    () => layoutRadial(skills.length, cx, cy, baseRadius),
    [skills.length, cx, cy, baseRadius]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[560px] overflow-hidden bg-[#0a0a0a] border select-none"
    >
      {/* Radial gradient background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(163,230,53,0.04) 0%, rgba(163,230,53,0.01) 35%, transparent 70%)",
        }}
      />

      {/* Subtle ring guides */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={dimensions.w}
        height={dimensions.h}
      >
        {/* Ring guides */}
        {Array.from({ length: Math.ceil(skills.length / 10) }).map((_, i) => (
          <circle
            key={`ring-${i}`}
            cx={cx}
            cy={cy}
            r={baseRadius + i * 90}
            fill="none"
            stroke="rgba(163,230,53,0.06)"
            strokeWidth={0.5}
            strokeDasharray="3 6"
          />
        ))}

        {/* Ray lines from center to each skill */}
        {positions.map((pos, i) => {
          const skill = skills[i];
          if (!skill) return null;
          const isHovered = hoveredSkill === skill.id;

          return (
            <line
              key={`ray-${skill.id}`}
              x1={cx}
              y1={cy}
              x2={pos.x}
              y2={pos.y}
              stroke={isHovered ? "rgba(163,230,53,0.35)" : "rgba(163,230,53,0.14)"}
              strokeWidth={0.7}
              strokeDasharray="2 4"
              style={{
                transition: "stroke 0.3s, stroke-width 0.3s",
              }}
            />
          );
        })}
      </svg>

      {/* Center agent avatar */}
      <div
        className="absolute z-20 flex flex-col items-center gap-1"
        style={{ left: cx - 32, top: cy - 44 }}
      >
        <div className="relative">
          <div className="h-16 w-16 border-2 border-primary bg-card flex items-center justify-center text-xl font-bold text-primary shadow-[0_0_20px_rgba(163,230,53,0.15)]">
            {agentInitials}
          </div>
      </div>
      <span className="text-[10px] text-muted-foreground font-medium whitespace-nowrap">
        {agentName}
      </span>
    </div>

      {/* Skill nodes positioned radially */}
      {positions.map((pos, i) => {
        const skill = skills[i];
        if (!skill) return null;
        const isHovered = hoveredSkill === skill.id;

        return (
          <div
            key={skill.id}
            data-skill-node
            className="absolute group animate-float-skill"
            style={{
              left: pos.x - 55,
              top: pos.y - 18,
              zIndex: isHovered ? 30 : 10,
              transition: "left 0.4s ease, top 0.4s ease",
              animationDelay: `${(i % 10) * 0.25}s`,
            }}
            onMouseEnter={() => setHoveredSkill(skill.id)}
            onMouseLeave={() => setHoveredSkill(null)}
          >
            {/* Node pill */}
            <div
              className={`
                relative flex items-center gap-1.5 px-2.5 py-1.5
                transition-all duration-200 whitespace-nowrap
                bg-card/80 border border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground
                ${isHovered ? "scale-110" : ""}
              `}
            >
              {/* Skill icon */}
              {skill.icon && (
                <span className="text-[10px] font-bold text-primary">
                  {skill.icon}
                </span>
              )}

              {/* Skill name */}
              <span className="text-sm font-medium">{skill.name}</span>
            </div>

            {/* Hover tooltip */}
            {isHovered && skill.description && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-56 p-3 bg-popover border border-border/80 text-popover-foreground animate-slide-up">
                <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                  {skill.description}
                </p>
              </div>
            )}
          </div>
        );
      })}

      {/* Bottom legend */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent z-30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
            Agent Skills
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 bg-muted-foreground/30" />
          <span className="text-[10px] text-muted-foreground">skills</span>
        </div>
      </div>
    </div>
  );
}
