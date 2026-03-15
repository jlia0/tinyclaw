import { PixelOfficeChar, type PixelCharAnim } from "@/components/pixel-office-char";

export type PixelDeskStatus = "empty" | "pending" | "running" | "done" | "error";

export type SceneQueueSnapshot = {
  incoming: number;
  processing: number;
  outgoing: number;
  activeConversations: number;
};

export type SceneTaskSummary = {
  label: string;
  count: number;
  tone: PixelDeskStatus;
};

export type SceneResponseItem = {
  id: string;
  label: string;
  subtitle: string;
  tone: PixelDeskStatus;
};

export type SceneRouteTarget = {
  label: string;
  color: string;
  state: PixelDeskStatus;
};

export type SceneBossRoom = {
  label: string;
  subtitle: string;
  commandText: string;
  commandTargets: string[];
  connected: boolean;
};

export type SceneArchiveRoom = {
  label: string;
};

export type SceneLounge = {
  label: string;
  agentCount: number;
  teamCount: number;
};

export type SceneTaskStation = {
  id: string;
  label: string;
  subtitle: string;
  status: PixelDeskStatus;
  kind: "task" | "route";
};

export type SceneAgent = {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  anim: PixelCharAnim;
  flip?: boolean;
};

export const PIXEL_SCENE_LAYOUT = {
  width: 1280,
  height: 720,
  bossRoomX: 40,
  bossRoomY: 26,
  bossRoomWidth: 360,
  bossRoomHeight: 272,
  archiveRoomX: 430,
  archiveRoomY: 26,
  archiveRoomWidth: 214,
  archiveRoomHeight: 272,
  orchestratorX: 478,
  orchestratorY: 112,
  orchestratorDeskWidth: 210,
  orchestratorDeskHeight: 82,
  queuePanelX: 40,
  queuePanelY: 28,
  queuePanelWidth: 340,
  routePanelX: 836,
  routePanelY: 26,
  routePanelWidth: 404,
  routePanelHeight: 224,
  loungeX: 34,
  loungeY: 560,
  loungeWidth: 560,
  loungeHeight: 104,
  stationAreaX: 34,
  stationAreaY: 434,
  stationAreaWidth: 560,
  stationAreaHeight: 108,
} as const;

const COLORS = {
  bg: "#13100e",
  floor: "#d2c4a7",
  floorLine: "#c4b491",
  wall: "#141110",
  wallTop: "#201b18",
  deskBase: "#221d19",
  deskTop: "#302923",
  deskBusy: "#253019",
  deskDone: "#1f3120",
  deskError: "#36201e",
  loungeFloor: "#191613",
  loungeAccent: "#3a332d",
  screen: "#0f0d0c",
  screenActive: "#1a2412",
  screenDone: "#152014",
  screenError: "#2a1515",
  panel: "#120f0e",
  panelBorder: "#2c2622",
  panelGlow: "#48611b",
  text: "#fafaf9",
  textMuted: "#a8a29e",
  textGreen: "#a3e635",
  textRed: "#ef4444",
  textAmber: "#f59e0b",
  textBlue: "#84cc16",
  cardBg: "#1c1917",
} as const;

function toneColor(tone: PixelDeskStatus) {
  if (tone === "done") return COLORS.textGreen;
  if (tone === "error") return COLORS.textRed;
  if (tone === "running") return COLORS.textBlue;
  if (tone === "pending") return COLORS.textAmber;
  return COLORS.textMuted;
}

function deskPalette(status: PixelDeskStatus) {
  if (status === "done") return { desk: COLORS.deskDone, border: COLORS.textGreen, screen: COLORS.screenDone };
  if (status === "error") return { desk: COLORS.deskError, border: COLORS.textRed, screen: COLORS.screenError };
  if (status === "running") return { desk: COLORS.deskBusy, border: COLORS.textBlue, screen: COLORS.screenActive };
  if (status === "pending") return { desk: COLORS.deskBase, border: COLORS.textAmber, screen: COLORS.screen };
  return { desk: COLORS.deskBase, border: "#2a2d3a", screen: COLORS.screen };
}

export function pointToPercent(x: number, y: number) {
  return {
    left: `${(x / PIXEL_SCENE_LAYOUT.width) * 100}%`,
    top: `${(y / PIXEL_SCENE_LAYOUT.height) * 100}%`,
  };
}

export function getLoungeMemberSpot(memberIndex: number, memberTotal: number) {
  const columns = Math.min(6, Math.max(1, memberTotal));
  const rows = Math.ceil(memberTotal / columns);
  const column = memberIndex % columns;
  const row = Math.floor(memberIndex / columns);
  const innerLeft = PIXEL_SCENE_LAYOUT.loungeX + 84;
  const innerRight = PIXEL_SCENE_LAYOUT.loungeX + PIXEL_SCENE_LAYOUT.loungeWidth - 84;
  const spacingX = columns === 1 ? 0 : (innerRight - innerLeft) / Math.max(1, columns - 1);
  const activityTop = PIXEL_SCENE_LAYOUT.loungeY + 48;
  const activityBottom = PIXEL_SCENE_LAYOUT.loungeY + PIXEL_SCENE_LAYOUT.loungeHeight - 26;
  const baseY = activityBottom;
  const spacingY = rows === 1 ? 0 : 26;
  return {
    x: innerLeft + column * spacingX,
    y: Math.max(activityTop + 18, baseY - row * spacingY),
  };
}

export function getTaskStationRect(index: number, total: number) {
  const columns = Math.min(4, Math.max(1, total));
  const rows = Math.min(2, Math.ceil(total / Math.max(1, columns)));
  const width = columns >= 4 ? 122 : columns === 3 ? 132 : 148;
  const gapX = columns >= 4 ? 16 : columns === 3 ? 20 : 26;
  const gapY = 34;
  const height = 96;
  const totalRowWidth = columns * width + (columns - 1) * gapX;
  const startX = PIXEL_SCENE_LAYOUT.stationAreaX + (PIXEL_SCENE_LAYOUT.stationAreaWidth - totalRowWidth) / 2;
  const row = Math.floor(index / Math.max(1, columns));
  const column = index % Math.max(1, columns);
  const totalHeight = rows * height + (rows - 1) * gapY;
  const startY = PIXEL_SCENE_LAYOUT.stationAreaY + (PIXEL_SCENE_LAYOUT.stationAreaHeight - totalHeight);
  return {
    x: startX + column * (width + gapX),
    y: startY + row * (height + gapY),
    width,
    height,
  };
}

export function getTaskStationMemberSpot(
  stationIndex: number,
  totalStations: number,
  memberIndex: number,
  memberTotal: number,
) {
  const station = getTaskStationRect(stationIndex, totalStations);
  const deskLeftX = station.x + 18;
  const deskFrontY = station.y + 84;
  if (memberTotal <= 1) return { x: deskLeftX, y: deskFrontY };
  if (memberTotal === 2) {
    return {
      x: deskLeftX + (memberIndex === 0 ? -10 : 14),
      y: deskFrontY + (memberIndex === 0 ? 2 : 0),
    };
  }
  const offsets = [-14, 8, 24];
  return {
    x: deskLeftX + offsets[Math.min(memberIndex, 2)],
    y: deskFrontY + (memberIndex === 1 ? -4 : 4),
  };
}

function Floor() {
  const lines = [];
  for (let y = 0; y < PIXEL_SCENE_LAYOUT.height; y += 40) {
    lines.push(
      <line key={`h-${y}`} x1={0} y1={y} x2={PIXEL_SCENE_LAYOUT.width} y2={y} stroke={COLORS.floorLine} strokeWidth={1} opacity={0.46} />,
    );
  }
  for (let x = 0; x <= PIXEL_SCENE_LAYOUT.width; x += 60) {
    lines.push(
      <line key={`v-${x}`} x1={x} y1={0} x2={x} y2={PIXEL_SCENE_LAYOUT.height} stroke={COLORS.floorLine} strokeWidth={1} opacity={0.24} />,
    );
  }
  return (
    <g>
      <rect x={0} y={0} width={PIXEL_SCENE_LAYOUT.width} height={PIXEL_SCENE_LAYOUT.height} fill={COLORS.floor} />
      {lines}
    </g>
  );
}

function splitStatusLabel(statusLabel: string) {
  if (statusLabel.length <= 18) return [statusLabel];
  const words = statusLabel.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= 18) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === 1) break;
  }
  if (current && lines.length < 2) lines.push(current);
  return lines.slice(0, 2).map((line, index, arr) => {
    if (index === arr.length - 1 && arr.join(" ").length < statusLabel.length) {
      return `${line.slice(0, Math.max(0, 15))}...`;
    }
    return line;
  });
}

function PixelPlant({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 10} y={y - 16} width={20} height={16} fill="#4a3728" rx={2} />
      <rect x={x - 12} y={y - 18} width={24} height={4} fill="#5a4738" rx={1} />
      <rect x={x - 1} y={y - 40} width={3} height={24} fill="#2d5a27" />
      <ellipse cx={x - 10} cy={y - 34} rx={10} ry={6} fill="#2d5a27" transform={`rotate(-28 ${x - 10} ${y - 34})`} />
      <ellipse cx={x + 10} cy={y - 30} rx={10} ry={6} fill="#3d7a33" transform={`rotate(26 ${x + 10} ${y - 30})`} />
      <ellipse cx={x} cy={y - 42} rx={8} ry={5} fill="#3d7a33" />
    </g>
  );
}

function PixelFlower({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 10} y={y - 16} width={20} height={16} fill="#6b4d38" rx={2} />
      <rect x={x - 12} y={y - 18} width={24} height={4} fill="#7a5a43" rx={1} />
      <rect x={x - 1} y={y - 36} width={3} height={20} fill="#3f6f2d" />
      <ellipse cx={x - 8} cy={y - 36} rx={6} ry={5} fill="#f59e0b" />
      <ellipse cx={x + 8} cy={y - 36} rx={6} ry={5} fill="#f59e0b" />
      <ellipse cx={x} cy={y - 42} rx={6} ry={5} fill="#ef4444" />
      <ellipse cx={x} cy={y - 31} rx={6} ry={5} fill="#fb7185" />
      <circle cx={x} cy={y - 36} r={4} fill="#fde68a" />
      <ellipse cx={x - 8} cy={y - 27} rx={7} ry={4} fill="#4d8b36" transform={`rotate(-20 ${x - 8} ${y - 27})`} />
      <ellipse cx={x + 8} cy={y - 25} rx={7} ry={4} fill="#4d8b36" transform={`rotate(20 ${x + 8} ${y - 25})`} />
    </g>
  );
}

function PixelWindowScene({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={86} height={56} fill="#d7eefc" rx={6} stroke="#8a7564" strokeWidth={1.5} />
      <rect x={x + 4} y={y + 4} width={78} height={48} fill="#c5e7fb" rx={4} />
      <rect x={x + 4} y={y + 28} width={78} height={24} fill="#b8dbef" rx={2} />
      <rect x={x + 4} y={y + 34} width={78} height={18} fill="#cfe7b7" rx={2} />
      <path d={`M ${x + 6} ${y + 48} Q ${x + 20} ${y + 36} ${x + 34} ${y + 47} T ${x + 62} ${y + 44} T ${x + 80} ${y + 47}`} fill="#99b97c" opacity={0.95} />
      <path d={`M ${x + 8} ${y + 42} Q ${x + 22} ${y + 32} ${x + 40} ${y + 39} T ${x + 78} ${y + 38}`} fill="#86a86d" opacity={0.9} />
      <circle cx={x + 20} cy={y + 16} r={6} fill="#fff6c8" opacity={0.9} />
      <rect x={x + 41} y={y + 4} width={4} height={48} fill="#8a7564" />
      <rect x={x + 4} y={y + 26} width={78} height={4} fill="#8a7564" />
    </g>
  );
}

function BossRoom({
  frame,
  bossRoom,
}: {
  frame: number;
  bossRoom: SceneBossRoom;
}) {
  const x = PIXEL_SCENE_LAYOUT.bossRoomX;
  const y = PIXEL_SCENE_LAYOUT.bossRoomY;
  const width = PIXEL_SCENE_LAYOUT.bossRoomWidth;
  const height = PIXEL_SCENE_LAYOUT.bossRoomHeight;
  const pulse = bossRoom.connected ? 0.12 + (Math.sin(frame / 8) + 1) * 0.05 : 0.03;
  const commandText = bossRoom.commandText.length > 34 ? `${bossRoom.commandText.slice(0, 34)}...` : bossRoom.commandText;
  const targetText = bossRoom.commandTargets.length > 0 ? bossRoom.commandTargets.join(" · ") : "no targets";

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="#7b6757" rx={12} stroke="#5b4b3f" strokeWidth={1.5} />
      <rect x={x + 12} y={y + 12} width={width - 24} height={height - 24} fill="#b48f72" rx={10} stroke="#8f7158" strokeWidth={1} />
      <rect x={x + 12} y={y + 128} width={width - 24} height={height - 140} fill="#8f745d" rx={0} />
      <rect x={x + 18} y={y + 18} width={112} height={18} fill={COLORS.cardBg} rx={4} stroke={COLORS.textBlue} strokeWidth={1} />
      <text x={x + 74} y={y + 31} textAnchor="middle" fontSize={12} fill={COLORS.textBlue} fontFamily="monospace">
        {bossRoom.label}
      </text>

      <rect x={x + 26} y={y + 70} width={152} height={74} fill="#6e5848" rx={10} stroke="#5a473a" strokeWidth={1} />
      <rect x={x + 38} y={y + 62} width={128} height={18} fill="#826957" rx={6} />
      <rect x={x + 32} y={y + 102} width={24} height={36} fill="#775f4f" rx={5} />
      <rect x={x + 148} y={y + 102} width={24} height={36} fill="#775f4f" rx={5} />
      <rect x={x + 54} y={y + 96} width={96} height={28} fill="#c8aa8e" rx={8} />
      <rect x={x + 60} y={y + 100} width={26} height={20} fill="#d4baa3" rx={5} />
      <rect x={x + 89} y={y + 100} width={26} height={20} fill="#dcc4af" rx={5} />
      <rect x={x + 118} y={y + 100} width={26} height={20} fill="#d4baa3" rx={5} />
      <rect x={x + 44} y={y + 140} width={20} height={5} fill="#3b2d24" rx={2} />
      <rect x={x + 140} y={y + 140} width={20} height={5} fill="#3b2d24" rx={2} />

      <PixelWindowScene x={x + 246} y={y + 52} />
      <rect x={x + 184} y={y + 152} width={122} height={42} fill="#2a221d" rx={8} stroke="#4d4034" strokeWidth={1} />
      <rect x={x + 194} y={y + 128} width={102} height={34} fill={bossRoom.connected ? COLORS.screenActive : COLORS.screen} rx={6} stroke="#f59e0b" strokeWidth={1.5} />
      <rect x={x + 230} y={y + 162} width={30} height={6} fill="#171311" rx={2} />
      <rect x={x + 222} y={y + 168} width={46} height={5} fill="#171311" rx={2} />
      <rect x={x + 212} y={y + 194} width={66} height={8} fill="#1d1815" rx={3} />
      <rect x={x + 204} y={y + 204} width={82} height={6} fill="#171311" rx={3} />
      <rect x={x + 296} y={y + 128} width={10} height={50} fill="#493d31" rx={3} />
      <circle cx={x + 302} cy={y + 122} r={10} fill="#5b4c3f" />
      <circle cx={x + 302} cy={y + 122} r={16} fill={COLORS.textAmber} opacity={pulse} />

      <rect x={x + 18} y={y + height - 18} width={width - 36} height={6} fill="#251f1a" rx={3} />
      <g transform={`translate(${x + 34}, ${y + height - 12}) scale(1.22)`}>
        <PixelFlower x={0} y={0} />
      </g>
      <PixelOfficeChar x={x + 102} y={y + 126} color="#f59e0b" anim="idle" frame={frame} size={1.02} />
    </g>
  );
}

function ArchiveRoom({
  frame,
  archiveRoom,
}: {
  frame: number;
  archiveRoom: SceneArchiveRoom;
}) {
  const x = PIXEL_SCENE_LAYOUT.archiveRoomX;
  const y = PIXEL_SCENE_LAYOUT.archiveRoomY;
  const width = PIXEL_SCENE_LAYOUT.archiveRoomWidth;
  const height = PIXEL_SCENE_LAYOUT.archiveRoomHeight;
  const glow = 0.08 + (Math.sin(frame / 10) + 1) * 0.04;
  const shelfRows = [52, 92, 132];

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="#6a584c" rx={12} stroke="#4c4036" strokeWidth={1.5} />
      <rect x={x + 12} y={y + 12} width={width - 24} height={height - 24} fill="#8a7564" rx={10} stroke="#665546" strokeWidth={1} />
      <rect x={x + 18} y={y + 14} width={92} height={18} fill={COLORS.cardBg} rx={4} stroke={COLORS.textBlue} strokeWidth={1} />
      <text x={x + 64} y={y + 27} textAnchor="middle" fontSize={12} fill={COLORS.textBlue} fontFamily="monospace">
        {archiveRoom.label}
      </text>
      <rect x={x + 18} y={y + 40} width={width - 36} height={height - 66} fill="#5a483d" rx={8} />
      {shelfRows.map((rowY) => (
        <rect key={rowY} x={x + 26} y={y + rowY} width={width - 52} height={6} fill="#3c2f27" rx={2} />
      ))}
      <rect x={x + 30} y={y + 34} width={14} height={108} fill="#493a30" rx={3} />
      <rect x={x + width - 44} y={y + 34} width={14} height={108} fill="#493a30" rx={3} />
      {Array.from({ length: 5 }).map((_, col) => (
        <g key={col}>
          <rect x={x + 38 + col * 26} y={y + 34} width={10} height={18 + ((col + 1) % 3) * 6} fill={["#a3e635", "#f59e0b", "#84cc16", "#ef4444", "#c084fc"][col]} rx={2} />
          <rect x={x + 38 + col * 26} y={y + 72} width={10} height={18 + (col % 3) * 6} fill={["#60a5fa", "#fb7185", "#facc15", "#4ade80", "#c4b5fd"][col]} rx={2} />
          <rect x={x + 38 + col * 26} y={y + 112} width={10} height={16 + ((col + 2) % 3) * 5} fill={["#f97316", "#22c55e", "#eab308", "#38bdf8", "#a78bfa"][col]} rx={2} />
        </g>
      ))}
      <rect x={x + 142} y={y + 38} width={44} height={96} fill="#6c5a4d" rx={5} stroke="#4a3d34" strokeWidth={1} />
      <rect x={x + 150} y={y + 46} width={28} height={18} fill="#3b3028" rx={3} />
      <rect x={x + 150} y={y + 72} width={28} height={18} fill="#3b3028" rx={3} />
      <rect x={x + 150} y={y + 98} width={28} height={28} fill="#3b3028" rx={3} />
      <circle cx={x + 164} cy={y + 112} r={9} fill="#fef3c7" opacity={glow} />
      <rect x={x + 68} y={y + 194} width={80} height={28} fill="#4a3b31" rx={7} stroke="#32261f" strokeWidth={1} />
      <rect x={x + 76} y={y + 184} width={64} height={16} fill="#7b6758" rx={5} />
      <rect x={x + 18} y={y + height - 18} width={width - 36} height={6} fill="#352922" rx={3} />
    </g>
  );
}

function QueuePanel({
  frame,
  queue,
}: {
  frame: number;
  queue: SceneQueueSnapshot;
}) {
  const counters = [
    { label: "incoming", value: queue.incoming, tone: "pending" as const },
    { label: "processing", value: queue.processing, tone: "running" as const },
    { label: "outgoing", value: queue.outgoing, tone: "done" as const },
    { label: "convos", value: queue.activeConversations, tone: "empty" as const },
  ];

  return (
    <g>
      <rect x={PIXEL_SCENE_LAYOUT.queuePanelX} y={PIXEL_SCENE_LAYOUT.queuePanelY} width={PIXEL_SCENE_LAYOUT.queuePanelWidth} height={180} fill={COLORS.panel} rx={10} stroke={COLORS.cardBg} strokeWidth={1.5} />
      <text x={PIXEL_SCENE_LAYOUT.queuePanelX + 20} y={PIXEL_SCENE_LAYOUT.queuePanelY + 24} fontSize={15} fill={COLORS.text} fontFamily="monospace" fontWeight={700}>
        queue monitor
      </text>
      <text x={PIXEL_SCENE_LAYOUT.queuePanelX + 20} y={PIXEL_SCENE_LAYOUT.queuePanelY + 44} fontSize={12} fill={COLORS.textMuted} fontFamily="monospace">
        live queue + room pressure
      </text>
      {counters.map((counter, index) => {
        const x = PIXEL_SCENE_LAYOUT.queuePanelX + 18 + (index % 2) * 152;
        const y = PIXEL_SCENE_LAYOUT.queuePanelY + 62 + Math.floor(index / 2) * 54;
        const color = toneColor(counter.tone);
        const glow = counter.value > 0 ? 0.14 + (Math.sin(frame / 6 + index) + 1) * 0.07 : 0;
        return (
          <g key={counter.label}>
            <rect x={x - 5} y={y - 5} width={132} height={42} fill={color} rx={7} opacity={glow} />
            <rect x={x} y={y} width={122} height={32} fill={COLORS.cardBg} rx={6} stroke={color} strokeWidth={1.5} />
            <text x={x + 12} y={y + 20} fontSize={11} fill={COLORS.textMuted} fontFamily="monospace">
              {counter.label}
            </text>
            <text x={x + 110} y={y + 21} textAnchor="end" fontSize={18} fill={color} fontFamily="monospace" fontWeight={700}>
              {counter.value}
            </text>
          </g>
        );
      })}
      <PixelPlant x={PIXEL_SCENE_LAYOUT.queuePanelX + PIXEL_SCENE_LAYOUT.queuePanelWidth - 26} y={PIXEL_SCENE_LAYOUT.queuePanelY + 180} />
    </g>
  );
}

function ControlConsole({
  frame,
  connected,
  statusLabel,
}: {
  frame: number;
  connected: boolean;
  statusLabel: string;
}) {
  const x = PIXEL_SCENE_LAYOUT.orchestratorX;
  const y = PIXEL_SCENE_LAYOUT.orchestratorY;
  const pulse = connected ? 0.18 + (Math.sin(frame / 4) + 1) * 0.08 : 0.06;
  const statusLines = splitStatusLabel(statusLabel);
  return (
    <g>
      <rect x={x - 10} y={y - 10} width={PIXEL_SCENE_LAYOUT.orchestratorDeskWidth + 20} height={PIXEL_SCENE_LAYOUT.orchestratorDeskHeight + 20} fill={COLORS.textBlue} rx={14} opacity={pulse} />
      <rect
        x={x}
        y={y}
        width={PIXEL_SCENE_LAYOUT.orchestratorDeskWidth}
        height={PIXEL_SCENE_LAYOUT.orchestratorDeskHeight}
        fill={COLORS.deskBase}
        rx={8}
        stroke={connected ? COLORS.textBlue : COLORS.textMuted}
        strokeWidth={2}
      />
      <rect x={x} y={y} width={PIXEL_SCENE_LAYOUT.orchestratorDeskWidth} height={12} fill={COLORS.deskTop} rx={8} />
      <rect x={x + 46} y={y + 14} width={118} height={56} fill={connected ? COLORS.screenActive : COLORS.screen} rx={5} stroke={COLORS.textBlue} strokeWidth={1} />
      <text x={x + 105} y={y + 33} textAnchor="middle" fontSize={11} fill={COLORS.textBlue} fontFamily="monospace">
        queue + routing
      </text>
      {statusLines.map((line, index) => (
        <text
          key={`${line}-${index}`}
          x={x + 105}
          y={y + 46 + index * 10}
          textAnchor="middle"
          fontSize={8.5}
          fill={COLORS.text}
          fontFamily="monospace"
        >
          {line}
        </text>
      ))}
      <rect x={x + 74} y={y + 72} width={62} height={10} fill="#1c1917" rx={2} />
      {Array.from({ length: 5 }).map((_, index) => (
        <rect key={index} x={x + 80 + index * 11} y={y + 74} width={7} height={6} fill={(frame + index) % 6 === 0 ? COLORS.textBlue : "#2a2d3a"} rx={1} />
      ))}
      <text x={x + 105} y={y + 102} textAnchor="middle" fontSize={18} fill={COLORS.text} fontFamily="monospace" fontWeight={700}>
        control console
      </text>
      <rect x={x + 76} y={y - 20} width={58} height={10} fill={COLORS.cardBg} rx={3} stroke={COLORS.loungeAccent} strokeWidth={1} />
      <rect x={x + 84} y={y - 14} width={10} height={12} fill={COLORS.textBlue} />
      <rect x={x + 100} y={y - 18} width={10} height={16} fill={COLORS.textAmber} />
      <rect x={x + 116} y={y - 10} width={10} height={8} fill={COLORS.textGreen} />
    </g>
  );
}

function RoutingPanel({
  frame,
  connected,
  routeRoot,
  routeTargets,
}: {
  frame: number;
  connected: boolean;
  routeRoot: string;
  routeTargets: SceneRouteTarget[];
}) {
  const x = PIXEL_SCENE_LAYOUT.routePanelX;
  const y = PIXEL_SCENE_LAYOUT.routePanelY;
  const width = PIXEL_SCENE_LAYOUT.routePanelWidth;
  const height = PIXEL_SCENE_LAYOUT.routePanelHeight;
  const scanX = x + 8 + ((frame * 7) % Math.max(10, width - 18));
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={COLORS.panel} rx={10} stroke={connected ? COLORS.panelGlow : COLORS.panelBorder} strokeWidth={1.5} />
      {connected && <rect x={scanX} y={y + 6} width={2} height={height - 12} fill={COLORS.panelGlow} opacity={0.18} rx={1} />}
      <text x={x + 18} y={y + 24} fontSize={15} fill={COLORS.text} fontFamily="monospace" fontWeight={700}>
        live routing
      </text>
      <text x={x + width - 18} y={y + 24} textAnchor="end" fontSize={12} fill={connected ? COLORS.textGreen : COLORS.textRed} fontFamily="monospace">
        {connected ? "sse online" : "sse offline"}
      </text>
      <rect x={x + 18} y={y + 52} width={144} height={34} fill={COLORS.cardBg} rx={6} stroke={COLORS.loungeAccent} strokeWidth={1.5} />
      <text x={x + 90} y={y + 73} textAnchor="middle" fontSize={12} fill={COLORS.text} fontFamily="monospace">
        {routeRoot.length > 18 ? `${routeRoot.slice(0, 18)}...` : routeRoot}
      </text>
      {routeTargets.slice(0, 3).map((target, index) => {
        const tx = x + 240;
        const ty = y + 48 + index * 52;
        const color = target.color || toneColor(target.state);
        return (
          <g key={`${target.label}-${index}`}>
            <line
              x1={x + 162}
              y1={y + 69}
              x2={tx}
              y2={ty + 17}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              className={connected ? "animate-dash" : undefined}
            />
            <rect x={tx} y={ty} width={146} height={34} fill={COLORS.cardBg} rx={6} stroke={color} strokeWidth={1.5} />
            <text x={tx + 73} y={ty + 21} textAnchor="middle" fontSize={12} fill={color} fontFamily="monospace">
              {target.label.length > 18 ? `${target.label.slice(0, 18)}...` : target.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Lounge({
  lounge,
}: {
  lounge: SceneLounge;
}) {
  const sofaX = PIXEL_SCENE_LAYOUT.loungeX + 56;
  const sofaY = PIXEL_SCENE_LAYOUT.loungeY + 44;
  const sofaWidth = PIXEL_SCENE_LAYOUT.loungeWidth - 112;
  return (
    <g>
      <rect
        x={PIXEL_SCENE_LAYOUT.loungeX + 10}
        y={PIXEL_SCENE_LAYOUT.loungeY - 18}
        width={116}
        height={18}
        fill={COLORS.cardBg}
        rx={4}
        stroke={COLORS.textBlue}
        strokeWidth={1}
      />
      <text
        x={PIXEL_SCENE_LAYOUT.loungeX + 68}
        y={PIXEL_SCENE_LAYOUT.loungeY - 5}
        textAnchor="middle"
        fontSize={12}
        fill={COLORS.textBlue}
        fontFamily="monospace"
      >
        {lounge.label}
      </text>
      <rect
        x={PIXEL_SCENE_LAYOUT.loungeX}
        y={PIXEL_SCENE_LAYOUT.loungeY}
        width={PIXEL_SCENE_LAYOUT.loungeWidth}
        height={PIXEL_SCENE_LAYOUT.loungeHeight}
        fill={COLORS.loungeFloor}
        rx={12}
        stroke={COLORS.textBlue}
        strokeWidth={1.5}
        opacity={0.92}
      />
      <rect
        x={PIXEL_SCENE_LAYOUT.loungeX + 8}
        y={PIXEL_SCENE_LAYOUT.loungeY + 8}
        width={PIXEL_SCENE_LAYOUT.loungeWidth - 16}
        height={PIXEL_SCENE_LAYOUT.loungeHeight - 16}
        fill="#151210"
        rx={8}
        stroke={COLORS.loungeAccent}
        strokeWidth={1}
      />
      <rect
        x={sofaX}
        y={sofaY}
        width={sofaWidth}
        height={34}
        fill="#46382f"
        rx={10}
        stroke="#6a5747"
        strokeWidth={1}
        opacity={0.96}
      />
      <rect
        x={sofaX + 14}
        y={sofaY - 10}
        width={sofaWidth - 28}
        height={12}
        fill="#5b4a3e"
        rx={5}
        opacity={0.98}
      />
      <rect
        x={sofaX + 6}
        y={sofaY + 6}
        width={20}
        height={28}
        fill="#54453a"
        rx={5}
      />
      <rect
        x={sofaX + sofaWidth - 26}
        y={sofaY + 6}
        width={20}
        height={28}
        fill="#54453a"
        rx={5}
      />
      <rect
        x={sofaX + 26}
        y={sofaY + 14}
        width={sofaWidth - 52}
        height={18}
        fill="#332922"
        rx={7}
        opacity={0.95}
      />
      <rect
        x={sofaX + 34}
        y={sofaY + 10}
        width={Math.floor((sofaWidth - 84) / 3)}
        height={20}
        fill="#6b594c"
        rx={5}
      />
      <rect
        x={sofaX + 42 + Math.floor((sofaWidth - 84) / 3)}
        y={sofaY + 10}
        width={Math.floor((sofaWidth - 84) / 3)}
        height={20}
        fill="#725f51"
        rx={5}
      />
      <rect
        x={sofaX + 50 + Math.floor(((sofaWidth - 84) / 3) * 2)}
        y={sofaY + 10}
        width={Math.floor((sofaWidth - 84) / 3)}
        height={20}
        fill="#6b594c"
        rx={5}
      />
      <rect
        x={sofaX + 34}
        y={sofaY + 31}
        width={sofaWidth - 68}
        height={6}
        fill="#251d18"
        rx={3}
        opacity={0.95}
      />
      <rect
        x={sofaX + 12}
        y={sofaY + 34}
        width={16}
        height={4}
        fill="#1f1814"
        rx={2}
      />
      <rect
        x={sofaX + sofaWidth - 28}
        y={sofaY + 34}
        width={16}
        height={4}
        fill="#1f1814"
        rx={2}
      />
      <rect
        x={sofaX + 32}
        y={sofaY + 9}
        width={2}
        height={22}
        fill="#877262"
        opacity={0.65}
      />
      <rect
        x={sofaX + sofaWidth / 2 - 1}
        y={sofaY + 9}
        width={2}
        height={22}
        fill="#877262"
        opacity={0.65}
      />
      <rect
        x={sofaX + sofaWidth - 34}
        y={sofaY + 9}
        width={2}
        height={22}
        fill="#877262"
        opacity={0.65}
      />
      <PixelPlant x={PIXEL_SCENE_LAYOUT.loungeX + 28} y={PIXEL_SCENE_LAYOUT.loungeY + PIXEL_SCENE_LAYOUT.loungeHeight - 2} />
      <PixelPlant x={PIXEL_SCENE_LAYOUT.loungeX + PIXEL_SCENE_LAYOUT.loungeWidth - 28} y={PIXEL_SCENE_LAYOUT.loungeY + PIXEL_SCENE_LAYOUT.loungeHeight - 2} />
    </g>
  );
}

function TaskStation({
  frame,
  station,
  working,
  index,
  total,
}: {
  frame: number;
  station: SceneTaskStation;
  working: boolean;
  index: number;
  total: number;
}) {
  const rect = getTaskStationRect(index, total);
  const deskX = rect.x + rect.width / 2 - 38;
  const deskY = rect.y + 16;
  const effectiveStatus = working ? "running" : station.status === "running" ? "pending" : station.status;
  const colors = deskPalette(effectiveStatus);
  const glow = working ? 0.18 + (Math.sin(frame / 5 + index) + 1) * 0.09 : effectiveStatus === "done" ? 0.2 : 0.07;
  const glowColor = toneColor(effectiveStatus);
  return (
    <g>
      <ellipse cx={deskX + 38} cy={deskY + 56} rx={42} ry={10} fill={glowColor} opacity={glow * 0.65} />
      <rect x={deskX + 6} y={deskY + 50} width={8} height={16} fill="#1a1d27" rx={2} />
      <rect x={deskX + 62} y={deskY + 50} width={8} height={16} fill="#1a1d27" rx={2} />
      <rect x={deskX} y={deskY + 8} width={76} height={44} fill={colors.desk} rx={6} stroke={colors.border} strokeWidth={1.5} />
      <rect x={deskX - 2} y={deskY} width={80} height={10} fill={COLORS.deskTop} rx={6} />
      <rect x={deskX + 24} y={deskY + 4} width={28} height={4} fill="#433830" rx={2} />
      <rect x={deskX + 22} y={deskY + 14} width={32} height={20} fill={colors.screen} rx={3} stroke={colors.border} strokeWidth={1} />
      <rect x={deskX + 34} y={deskY + 34} width={8} height={5} fill="#1a1d27" />
      <rect x={deskX + 30} y={deskY + 39} width={16} height={3} fill="#1a1d27" rx={1} />
      <rect x={deskX + 25} y={deskY + 45} width={24} height={6} fill="#1c1917" rx={2} stroke="#3a332d" strokeWidth={0.8} />
      <rect x={deskX + 28} y={deskY + 58} width={18} height={10} fill="#2c2622" rx={4} />
      {working && (
        <>
          {Array.from({ length: 4 }).map((_, row) => (
            <rect
              key={row}
              x={deskX + 26 + (row % 2) * 2}
              y={deskY + 18 + row * 4}
              width={8 + ((row * 7) % 6)}
              height={2}
              fill={COLORS.textBlue}
              opacity={0.35 + ((frame + row) % 3) * 0.15}
              rx={1}
            />
          ))}
        </>
      )}
      {effectiveStatus === "pending" && (
        <text x={deskX + 38} y={deskY + 28} textAnchor="middle" fontSize={10} fill={COLORS.textAmber} fontFamily="monospace">
          ...
        </text>
      )}
      {effectiveStatus === "done" && (
        <text x={deskX + 38} y={deskY + 28} textAnchor="middle" fontSize={14} fill={COLORS.textGreen} fontFamily="monospace">
          ✓
        </text>
      )}
      {effectiveStatus === "error" && (
        <text x={deskX + 38} y={deskY + 28} textAnchor="middle" fontSize={14} fill={COLORS.textRed} fontFamily="monospace">
          ✗
        </text>
      )}
      {Array.from({ length: 6 }).map((_, key) => (
        <rect key={key} x={deskX + 27 + key * 3} y={deskY + 47} width={2} height={2} fill={working && (frame + key) % 6 === 0 ? COLORS.textBlue : "#3a332d"} rx={1} />
      ))}
    </g>
  );
}

function TaskSummaryPanel({
  summaries,
}: {
  summaries: SceneTaskSummary[];
}) {
  const x = PIXEL_SCENE_LAYOUT.routePanelX;
  const y = 266;
  return (
    <g>
      <rect x={x} y={y} width={PIXEL_SCENE_LAYOUT.routePanelWidth} height={84} fill={COLORS.panel} rx={10} stroke={COLORS.cardBg} strokeWidth={1.5} />
      <text x={x + 18} y={y + 24} fontSize={15} fill={COLORS.text} fontFamily="monospace" fontWeight={700}>
        task board
      </text>
      {summaries.map((summary, index) => {
        const cardX = x + 18 + index * 94;
        const color = toneColor(summary.tone);
        return (
          <g key={summary.label}>
            <rect x={cardX} y={y + 36} width={82} height={28} fill={COLORS.cardBg} rx={6} stroke={color} strokeWidth={1.5} />
            <text x={cardX + 10} y={y + 53} fontSize={10} fill={COLORS.textMuted} fontFamily="monospace">
              {summary.label}
            </text>
            <text x={cardX + 72} y={y + 53} textAnchor="end" fontSize={15} fill={color} fontFamily="monospace" fontWeight={700}>
              {summary.count}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function ResponseDock({
  responses,
}: {
  responses: SceneResponseItem[];
}) {
  const x = PIXEL_SCENE_LAYOUT.routePanelX;
  const y = 366;
  return (
    <g>
      <rect x={x} y={y} width={PIXEL_SCENE_LAYOUT.routePanelWidth} height={288} fill={COLORS.panel} rx={10} stroke={COLORS.cardBg} strokeWidth={1.5} />
      <text x={x + 18} y={y + 24} fontSize={15} fill={COLORS.text} fontFamily="monospace" fontWeight={700}>
        outgoing dock
      </text>
      <text x={x + 18} y={y + 44} fontSize={12} fill={COLORS.textMuted} fontFamily="monospace">
        recent responses ready to ship
      </text>
      {responses.slice(0, 6).map((response, index) => {
        const rowY = y + 60 + index * 34;
        const color = toneColor(response.tone);
        return (
          <g key={response.id}>
            <rect x={x + 18} y={rowY} width={PIXEL_SCENE_LAYOUT.routePanelWidth - 36} height={24} fill={COLORS.cardBg} rx={6} stroke={color} strokeWidth={1.2} />
            <text x={x + 28} y={rowY + 16} fontSize={11} fill={color} fontFamily="monospace">
              {response.label.length > 34 ? `${response.label.slice(0, 34)}...` : response.label}
            </text>
            <text x={x + PIXEL_SCENE_LAYOUT.routePanelWidth - 28} y={rowY + 16} textAnchor="end" fontSize={10} fill={COLORS.textMuted} fontFamily="monospace">
              {response.subtitle.length > 18 ? `${response.subtitle.slice(0, 18)}...` : response.subtitle}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function PixelOfficeScene({
  frame,
  connected,
  statusLabel,
  queue,
  bossRoom,
  archiveRoom,
  routeRoot,
  routeTargets,
  lounge,
  taskStations,
  taskSummaries,
  responses,
  agents,
}: {
  frame: number;
  connected: boolean;
  statusLabel: string;
  queue: SceneQueueSnapshot;
  bossRoom: SceneBossRoom;
  archiveRoom: SceneArchiveRoom;
  routeRoot: string;
  routeTargets: SceneRouteTarget[];
  lounge: SceneLounge;
  taskStations: SceneTaskStation[];
  taskSummaries: SceneTaskSummary[];
  responses: SceneResponseItem[];
  agents: SceneAgent[];
}) {
  return (
    <div className="relative size-full overflow-hidden rounded-md border border-border bg-[#13100e]">
      <svg viewBox={`0 0 ${PIXEL_SCENE_LAYOUT.width} ${PIXEL_SCENE_LAYOUT.height}`} className="absolute inset-0 size-full">
        <Floor />
        <BossRoom frame={frame} bossRoom={bossRoom} />
        <ArchiveRoom frame={frame} archiveRoom={archiveRoom} />

        <Lounge lounge={lounge} />

        {taskStations.map((station, index) => {
          const linkedAgentId = station.id.startsWith("desk-") ? station.id.slice(5) : "";
          const working = agents.some((agent) => agent.id === linkedAgentId && agent.anim === "type");
          return (
            <TaskStation
              key={station.id}
              frame={frame}
              station={station}
              working={working}
              index={index}
              total={Math.max(1, taskStations.length)}
            />
          );
        })}

        {agents.map((agent) => (
          <g key={agent.id}>
            <PixelOfficeChar x={agent.x} y={agent.y} color={agent.color} anim={agent.anim} frame={frame} flip={agent.flip} size={1.05} />
            <rect
              x={agent.x - 42}
              y={
                agent.y >= PIXEL_SCENE_LAYOUT.loungeY && agent.y <= PIXEL_SCENE_LAYOUT.loungeY + PIXEL_SCENE_LAYOUT.loungeHeight
                  ? agent.y + 2
                  : agent.y + 10
              }
              width={84}
              height={16}
              fill="#0d1117"
              rx={3}
              opacity={0.82}
            />
            <text
              x={agent.x}
              y={
                agent.y >= PIXEL_SCENE_LAYOUT.loungeY && agent.y <= PIXEL_SCENE_LAYOUT.loungeY + PIXEL_SCENE_LAYOUT.loungeHeight
                  ? agent.y + 14
                  : agent.y + 22
              }
              textAnchor="middle"
              fontSize={12}
              fill={COLORS.text}
              fontFamily="monospace"
            >
              @{agent.label.length > 10 ? `${agent.label.slice(0, 10)}...` : agent.label}
            </text>
          </g>
        ))}

      </svg>
    </div>
  );
}
