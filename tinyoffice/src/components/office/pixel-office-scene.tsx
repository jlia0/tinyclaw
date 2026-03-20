import type { CSSProperties } from "react";

import {
  PixelOfficeChar,
  type PixelCharAnim,
  type PixelCharFacing,
} from "./pixel-office-char";

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

const FLOOR_TILE = 40;
const SPRITE_SCALE = 2.25;

export const PIXEL_SCENE_LAYOUT = {
  width: 1280,
  height: 720,
  bossRoomX: 48,
  bossRoomY: 40,
  bossRoomWidth: 184,
  bossRoomHeight: 156,
  archiveRoomX: 252,
  archiveRoomY: 40,
  archiveRoomWidth: 216,
  archiveRoomHeight: 156,
  orchestratorX: 554,
  orchestratorY: 106,
  orchestratorDeskWidth: 160,
  orchestratorDeskHeight: 84,
  queuePanelX: 500,
  queuePanelY: 40,
  queuePanelWidth: 214,
  routePanelX: 500,
  routePanelY: 40,
  routePanelWidth: 214,
  routePanelHeight: 128,
  loungeX: 56,
  loungeY: 586,
  loungeWidth: 604,
  loungeHeight: 120,
  stationAreaX: 44,
  stationAreaY: 228,
  stationAreaWidth: 624,
  stationAreaHeight: 272,
} as const;

const FLOOR_ASSETS = {
  main: "/assets/pixel-agents/floors/floor_6.png",
  rooms: "/assets/pixel-agents/floors/floor_4.png",
  archive: "/assets/pixel-agents/floors/floor_3.png",
  lounge: "/assets/pixel-agents/floors/floor_5.png",
  rug: "/assets/pixel-agents/floors/floor_8.png",
} as const;

const FURNITURE = {
  deskFront: { src: "/assets/pixel-agents/furniture/DESK/DESK_FRONT.png", width: 48, height: 32 },
  tableFront: { src: "/assets/pixel-agents/furniture/TABLE_FRONT/TABLE_FRONT.png", width: 48, height: 64 },
  smallTableFront: { src: "/assets/pixel-agents/furniture/SMALL_TABLE/SMALL_TABLE_FRONT.png", width: 32, height: 32 },
  smallTableSide: { src: "/assets/pixel-agents/furniture/SMALL_TABLE/SMALL_TABLE_SIDE.png", width: 16, height: 48 },
  pcOff: { src: "/assets/pixel-agents/furniture/PC/PC_FRONT_OFF.png", width: 16, height: 32 },
  pcOn1: { src: "/assets/pixel-agents/furniture/PC/PC_FRONT_ON_1.png", width: 16, height: 32 },
  pcOn2: { src: "/assets/pixel-agents/furniture/PC/PC_FRONT_ON_2.png", width: 16, height: 32 },
  pcOn3: { src: "/assets/pixel-agents/furniture/PC/PC_FRONT_ON_3.png", width: 16, height: 32 },
  pcSide: { src: "/assets/pixel-agents/furniture/PC/PC_SIDE.png", width: 16, height: 32 },
  whiteboard: { src: "/assets/pixel-agents/furniture/WHITEBOARD/WHITEBOARD.png", width: 32, height: 32 },
  bookshelf: { src: "/assets/pixel-agents/furniture/DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png", width: 32, height: 32 },
  sofaFront: { src: "/assets/pixel-agents/furniture/SOFA/SOFA_FRONT.png", width: 32, height: 16 },
  sofaBack: { src: "/assets/pixel-agents/furniture/SOFA/SOFA_BACK.png", width: 32, height: 16 },
  sofaSide: { src: "/assets/pixel-agents/furniture/SOFA/SOFA_SIDE.png", width: 16, height: 32 },
  coffeeTable: { src: "/assets/pixel-agents/furniture/COFFEE_TABLE/COFFEE_TABLE.png", width: 32, height: 32 },
  coffee: { src: "/assets/pixel-agents/furniture/COFFEE/COFFEE.png", width: 16, height: 16 },
  cushionedBench: { src: "/assets/pixel-agents/furniture/CUSHIONED_BENCH/CUSHIONED_BENCH.png", width: 16, height: 16 },
  woodenChairSide: { src: "/assets/pixel-agents/furniture/WOODEN_CHAIR/WOODEN_CHAIR_SIDE.png", width: 16, height: 32 },
  plant: { src: "/assets/pixel-agents/furniture/PLANT/PLANT.png", width: 16, height: 32 },
  plant2: { src: "/assets/pixel-agents/furniture/PLANT_2/PLANT_2.png", width: 16, height: 32 },
  largePlant: { src: "/assets/pixel-agents/furniture/LARGE_PLANT/LARGE_PLANT.png", width: 32, height: 48 },
  hangingPlant: { src: "/assets/pixel-agents/furniture/HANGING_PLANT/HANGING_PLANT.png", width: 16, height: 32 },
  paintingLarge: { src: "/assets/pixel-agents/furniture/LARGE_PAINTING/LARGE_PAINTING.png", width: 32, height: 32 },
  paintingSmall: { src: "/assets/pixel-agents/furniture/SMALL_PAINTING/SMALL_PAINTING.png", width: 16, height: 32 },
  paintingSmall2: { src: "/assets/pixel-agents/furniture/SMALL_PAINTING_2/SMALL_PAINTING_2.png", width: 16, height: 32 },
  bin: { src: "/assets/pixel-agents/furniture/BIN/BIN.png", width: 16, height: 16 },
  clock: { src: "/assets/pixel-agents/furniture/CLOCK/CLOCK.png", width: 16, height: 32 },
} as const;

function toPercent(value: number, total: number) {
  return `${(value / total) * 100}%`;
}

function rectStyle(x: number, y: number, width: number, height: number, zIndex?: number): CSSProperties {
  return {
    left: toPercent(x, PIXEL_SCENE_LAYOUT.width),
    top: toPercent(y, PIXEL_SCENE_LAYOUT.height),
    width: toPercent(width, PIXEL_SCENE_LAYOUT.width),
    height: toPercent(height, PIXEL_SCENE_LAYOUT.height),
    ...(zIndex === undefined ? {} : { zIndex }),
  };
}

function scaledAsset(
  asset: { width: number; height: number },
  scale = SPRITE_SCALE,
) {
  return {
    width: asset.width * scale,
    height: asset.height * scale,
  };
}

export function pointToPercent(x: number, y: number) {
  return {
    left: toPercent(x, PIXEL_SCENE_LAYOUT.width),
    top: toPercent(y, PIXEL_SCENE_LAYOUT.height),
  };
}

export function getLoungeMemberSpot(memberIndex: number, memberTotal: number) {
  const innerLeft = PIXEL_SCENE_LAYOUT.loungeX + 84;
  const innerRight = PIXEL_SCENE_LAYOUT.loungeX + PIXEL_SCENE_LAYOUT.loungeWidth - 84;
  const count = Math.max(1, memberTotal);
  const spacingX = count === 1 ? 0 : (innerRight - innerLeft) / (count - 1);
  return {
    x: count === 1 ? (innerLeft + innerRight) / 2 : innerLeft + memberIndex * spacingX,
    y: PIXEL_SCENE_LAYOUT.loungeY + PIXEL_SCENE_LAYOUT.loungeHeight - 12,
  };
}

export function getTaskStationRect(index: number, total: number) {
  const columns = total >= 7 ? 4 : total <= 2 ? total : total <= 4 ? 2 : 3;
  const normalizedColumns = Math.max(1, columns);
  const rows = Math.ceil(total / normalizedColumns);
  const gapX = normalizedColumns >= 4 ? 14 : 20;
  const gapY = 18;
  const width =
    normalizedColumns === 1
      ? PIXEL_SCENE_LAYOUT.stationAreaWidth - 24
      : (PIXEL_SCENE_LAYOUT.stationAreaWidth - gapX * (normalizedColumns - 1)) / normalizedColumns;
  const height =
    rows === 1
      ? PIXEL_SCENE_LAYOUT.stationAreaHeight - 14
      : (PIXEL_SCENE_LAYOUT.stationAreaHeight - gapY * (rows - 1)) / rows;
  const totalRowWidth = normalizedColumns * width + (normalizedColumns - 1) * gapX;
  const startX = PIXEL_SCENE_LAYOUT.stationAreaX + (PIXEL_SCENE_LAYOUT.stationAreaWidth - totalRowWidth) / 2;
  const startY = PIXEL_SCENE_LAYOUT.stationAreaY + 6;
  const row = Math.floor(index / normalizedColumns);
  const column = index % normalizedColumns;
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
  const baseX = station.x + station.width / 2;
  const baseY = station.y + Math.min(station.height - 8, 122);
  if (memberTotal <= 1) return { x: baseX, y: baseY };
  if (memberTotal === 2) {
    return {
      x: baseX + (memberIndex === 0 ? -18 : 18),
      y: baseY + (memberIndex === 0 ? 4 : 0),
    };
  }
  const offsets = [-26, 0, 26];
  return {
    x: baseX + offsets[Math.min(memberIndex, 2)],
    y: baseY + (memberIndex === 1 ? 0 : 6),
  };
}

function FloorArea({
  x,
  y,
  width,
  height,
  texture,
  opacity = 1,
  zIndex = 1,
  insetBorder = false,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  texture: string;
  opacity?: number;
  zIndex?: number;
  insetBorder?: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        ...rectStyle(x, y, width, height, zIndex),
        backgroundImage: `url(${texture})`,
        backgroundRepeat: "repeat",
        backgroundSize: `${(FLOOR_TILE / width) * 100}% ${(FLOOR_TILE / height) * 100}%`,
        imageRendering: "pixelated",
        opacity,
        boxShadow: insetBorder ? "0 0 0 1px rgba(98, 77, 60, 0.18) inset" : undefined,
      }}
    />
  );
}

function WallTile({
  x,
  y,
  tileX,
  tileY,
  zIndex = 20,
  width = FLOOR_TILE,
}: {
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  zIndex?: number;
  width?: number;
}) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        ...rectStyle(x, y, width, FLOOR_TILE, zIndex),
        backgroundImage: "url(/assets/pixel-agents/walls/wall_0.png)",
        backgroundRepeat: "no-repeat",
        backgroundSize: "400% 800%",
        backgroundPosition: `${(tileX / 3) * 100}% ${(tileY / 7) * 100}%`,
        imageRendering: "pixelated",
      }}
    />
  );
}

function RoomWallBand({
  x,
  y,
  width,
  height = 28,
  zIndex = 7,
}: {
  x: number;
  y: number;
  width: number;
  height?: number;
  zIndex?: number;
}) {
  return (
    <div
      className="pointer-events-none absolute border-b border-[#5a4f47]"
      style={{
        ...rectStyle(x, y, width, height, zIndex),
        background:
          "linear-gradient(180deg, rgba(236,233,227,0.98) 0%, rgba(225,220,212,0.98) 72%, rgba(211,203,194,0.98) 100%)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.45) inset",
      }}
    />
  );
}

function RoomSideCap({
  x,
  y,
  width = FLOOR_TILE / 2,
  height = FLOOR_TILE,
  zIndex = 9,
  side = "left",
}: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  zIndex?: number;
  side?: "left" | "right";
}) {
  return (
    <div
      className={`pointer-events-none absolute ${side === "left" ? "border-r" : "border-l"} border-[#564a42]`}
      style={{
        ...rectStyle(x, y, width, height, zIndex),
        background:
          "linear-gradient(180deg, rgba(214,208,199,0.98) 0%, rgba(203,197,188,0.98) 100%)",
      }}
    />
  );
}

function Sprite({
  src,
  x,
  y,
  width,
  height,
  zIndex,
  mirror = false,
  opacity = 1,
}: {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  mirror?: boolean;
  opacity?: number;
}) {
  return (
    // Use a raw img so the sprite sheet keeps pixel-perfect rendering.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      draggable={false}
      src={src}
      className="pointer-events-none absolute select-none"
      style={{
        ...rectStyle(x, y, width, height, zIndex),
        imageRendering: "pixelated",
        transform: mirror ? "scaleX(-1)" : undefined,
        transformOrigin: "center",
        opacity,
      }}
    />
  );
}

function DeskMonitor({
  x,
  y,
  status,
  frame,
  zIndex,
}: {
  x: number;
  y: number;
  status: PixelDeskStatus;
  frame: number;
  zIndex: number;
}) {
  const asset =
    status === "running"
      ? [FURNITURE.pcOn1, FURNITURE.pcOn2, FURNITURE.pcOn3][Math.abs(frame) % 3]
      : status === "done"
        ? FURNITURE.pcOn2
        : status === "pending"
          ? FURNITURE.pcOn1
          : FURNITURE.pcOff;
  const size = scaledAsset(asset, 2);
  return <Sprite src={asset.src} x={x} y={y} width={size.width} height={size.height} zIndex={zIndex} />;
}

function RoomHeader({ x, y, title }: { x: number; y: number; title: string }) {
  return (
    <div
      className="pointer-events-none absolute inline-flex items-center border px-3 py-1 font-mono"
      style={{
        left: toPercent(x, PIXEL_SCENE_LAYOUT.width),
        top: toPercent(y, PIXEL_SCENE_LAYOUT.height),
        zIndex: 40,
        borderColor: "#465e14",
        background: "#1e2414",
        color: "#a3e635",
        boxShadow: "0 1px 0 rgba(255,255,255,0.08) inset",
        transform: "translateY(calc(-100% - 6px))",
      }}
    >
      <div className="text-[12px] font-bold whitespace-nowrap" style={{ color: "#a3e635" }}>
        {title}
      </div>
    </div>
  );
}

function BossAgent({ x, y, zIndex }: { x: number; y: number; zIndex: number }) {
  const width = 44;
  const height = 64;
  return (
    <>
      <div
        className="pointer-events-none absolute rounded-full bg-[#120d09]/22"
        style={rectStyle(x - 14, y + 48, 28, 8, zIndex - 1)}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          ...rectStyle(x - width / 2, y, width, height, zIndex),
          backgroundImage: "url(/assets/pixel-agents/characters/char_4.png)",
          backgroundRepeat: "no-repeat",
          backgroundSize: "700% 300%",
          backgroundPosition: `${(3 / 6) * 100}% 0%`,
          imageRendering: "pixelated",
          filter: "drop-shadow(0 4px 6px rgba(17, 24, 39, 0.18))",
        }}
      />
    </>
  );
}

function DrinkMachine({ x, y, zIndex }: { x: number; y: number; zIndex: number }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        ...rectStyle(x, y, 42, 58, zIndex),
      }}
    >
      <svg viewBox="0 0 42 58" className="size-full" shapeRendering="crispEdges">
        <rect x="0" y="0" width="42" height="58" fill="#d9e5ee" />
        <rect x="0" y="0" width="42" height="10" fill="#a8c7dd" />
        <rect x="3" y="12" width="24" height="38" fill="#7e4d5a" />
        <rect x="6" y="16" width="6" height="14" fill="#d6e6ef" />
        <rect x="14" y="16" width="10" height="10" fill="#cddf8a" />
        <rect x="14" y="28" width="10" height="16" fill="#e8edf2" />
        <rect x="6" y="34" width="6" height="10" fill="#e8edf2" />
        <rect x="29" y="12" width="10" height="38" fill="#342830" />
        <rect x="31" y="16" width="6" height="6" fill="#7a5d4f" />
        <rect x="31" y="24" width="6" height="6" fill="#7a5d4f" />
        <rect x="31" y="32" width="6" height="6" fill="#7a5d4f" />
        <rect x="31" y="40" width="6" height="6" fill="#7a5d4f" />
        <rect x="3" y="50" width="36" height="4" fill="#51606d" />
        <rect x="0" y="54" width="42" height="4" fill="#8f9ea8" />
        <rect x="0" y="0" width="42" height="58" fill="none" stroke="#51606d" strokeWidth="2" />
      </svg>
    </div>
  );
}

function DeskStation({
  station,
  index,
  total,
  frame,
}: {
  station: SceneTaskStation;
  index: number;
  total: number;
  frame: number;
}) {
  const area = getTaskStationRect(index, total);
  const deskSize = scaledAsset(FURNITURE.deskFront);
  const benchSize = scaledAsset(FURNITURE.cushionedBench, 2.3);
  const deskX = area.x + (area.width - deskSize.width) / 2;
  const deskY = area.y + 16;
  const benchX = area.x + area.width / 2 - benchSize.width / 2;
  const benchY = deskY + deskSize.height - 4;
  const monitorX = area.x + area.width / 2 - 16;
  const monitorY = deskY + 10;

  return (
    <>
      <Sprite src={FURNITURE.deskFront.src} x={deskX} y={deskY} width={deskSize.width} height={deskSize.height} zIndex={44 + index} />
      <Sprite
        src={FURNITURE.cushionedBench.src}
        x={benchX}
        y={benchY}
        width={benchSize.width}
        height={benchSize.height}
        zIndex={46 + index}
      />
      <DeskMonitor x={monitorX} y={monitorY} status={station.status} frame={frame} zIndex={47 + index} />
    </>
  );
}

function StaticOfficeFurniture({ bossRoom, archiveRoom }: { bossRoom: SceneBossRoom; archiveRoom: SceneArchiveRoom }) {
  const board = scaledAsset(FURNITURE.whiteboard);
  const book = scaledAsset(FURNITURE.bookshelf);
  const paintingLarge = scaledAsset(FURNITURE.paintingLarge);
  const smallPainting = scaledAsset(FURNITURE.paintingSmall, 2);
  const clock = scaledAsset(FURNITURE.clock, 2);
  const plantLarge = scaledAsset(FURNITURE.largePlant, 1.9);
  const hangingPlant = scaledAsset(FURNITURE.hangingPlant, 2);
  const sofaFront = scaledAsset(FURNITURE.sofaFront, 1.9);
  const coffeeTable = scaledAsset(FURNITURE.coffeeTable, 2.1);
  const coffeeCup = scaledAsset(FURNITURE.coffee, 2);
  const chairSide = scaledAsset(FURNITURE.woodenChairSide, 1.9);

  return (
    <>
      <RoomHeader x={PIXEL_SCENE_LAYOUT.bossRoomX + 10} y={PIXEL_SCENE_LAYOUT.bossRoomY + 8} title={bossRoom.label} />
      <RoomHeader x={PIXEL_SCENE_LAYOUT.archiveRoomX + 10} y={PIXEL_SCENE_LAYOUT.archiveRoomY + 8} title={archiveRoom.label} />

      <Sprite src={FURNITURE.whiteboard.src} x={PIXEL_SCENE_LAYOUT.bossRoomX + 18} y={PIXEL_SCENE_LAYOUT.bossRoomY + 40} width={board.width} height={board.height} zIndex={34} />
      <Sprite src={FURNITURE.paintingLarge.src} x={PIXEL_SCENE_LAYOUT.bossRoomX + 100} y={PIXEL_SCENE_LAYOUT.bossRoomY + 34} width={paintingLarge.width} height={paintingLarge.height} zIndex={34} />
      <Sprite src={FURNITURE.sofaFront.src} x={PIXEL_SCENE_LAYOUT.bossRoomX + 66} y={PIXEL_SCENE_LAYOUT.bossRoomY + 112} width={sofaFront.width} height={sofaFront.height} zIndex={41} />
      <BossAgent x={PIXEL_SCENE_LAYOUT.bossRoomX + 96} y={PIXEL_SCENE_LAYOUT.bossRoomY + 86} zIndex={42} />
      <Sprite src={FURNITURE.hangingPlant.src} x={PIXEL_SCENE_LAYOUT.bossRoomX + 16} y={PIXEL_SCENE_LAYOUT.bossRoomY + 24} width={hangingPlant.width} height={hangingPlant.height} zIndex={44} />

      <Sprite src={FURNITURE.bookshelf.src} x={PIXEL_SCENE_LAYOUT.archiveRoomX + 18} y={PIXEL_SCENE_LAYOUT.archiveRoomY + 52} width={book.width} height={book.height} zIndex={34} />
      <Sprite src={FURNITURE.bookshelf.src} x={PIXEL_SCENE_LAYOUT.archiveRoomX + 18} y={PIXEL_SCENE_LAYOUT.archiveRoomY + 94} width={book.width} height={book.height} zIndex={34} />
      <Sprite src={FURNITURE.bookshelf.src} x={PIXEL_SCENE_LAYOUT.archiveRoomX + 94} y={PIXEL_SCENE_LAYOUT.archiveRoomY + 94} width={book.width} height={book.height} zIndex={34} />
      <Sprite src={FURNITURE.clock.src} x={PIXEL_SCENE_LAYOUT.archiveRoomX + 20} y={PIXEL_SCENE_LAYOUT.archiveRoomY + 24} width={clock.width} height={clock.height} zIndex={36} />
      <Sprite src={FURNITURE.coffee.src} x={PIXEL_SCENE_LAYOUT.archiveRoomX + 176} y={PIXEL_SCENE_LAYOUT.archiveRoomY + 108} width={36} height={36} zIndex={39} />
      <Sprite src={FURNITURE.largePlant.src} x={PIXEL_SCENE_LAYOUT.archiveRoomX + 178} y={PIXEL_SCENE_LAYOUT.archiveRoomY + 100} width={plantLarge.width} height={plantLarge.height} zIndex={40} />

      <DrinkMachine x={PIXEL_SCENE_LAYOUT.routePanelX + 28} y={PIXEL_SCENE_LAYOUT.routePanelY + 46} zIndex={35} />
      <Sprite src={FURNITURE.whiteboard.src} x={PIXEL_SCENE_LAYOUT.routePanelX + 84} y={PIXEL_SCENE_LAYOUT.routePanelY + 40} width={board.width} height={board.height} zIndex={34} />
      <Sprite src={FURNITURE.paintingSmall.src} x={PIXEL_SCENE_LAYOUT.routePanelX + 160} y={PIXEL_SCENE_LAYOUT.routePanelY + 44} width={smallPainting.width} height={smallPainting.height} zIndex={34} />
      <Sprite src={FURNITURE.woodenChairSide.src} x={PIXEL_SCENE_LAYOUT.routePanelX + 58} y={PIXEL_SCENE_LAYOUT.routePanelY + 100} width={chairSide.width} height={chairSide.height} zIndex={39} />
      <Sprite src={FURNITURE.coffeeTable.src} x={PIXEL_SCENE_LAYOUT.routePanelX + 82} y={PIXEL_SCENE_LAYOUT.routePanelY + 92} width={coffeeTable.width} height={coffeeTable.height} zIndex={40} />
      <Sprite src={FURNITURE.coffee.src} x={PIXEL_SCENE_LAYOUT.routePanelX + 84} y={PIXEL_SCENE_LAYOUT.routePanelY + 120} width={coffeeCup.width} height={coffeeCup.height} zIndex={41} />
      <Sprite src={FURNITURE.woodenChairSide.src} x={PIXEL_SCENE_LAYOUT.routePanelX + 148} y={PIXEL_SCENE_LAYOUT.routePanelY + 100} width={chairSide.width} height={chairSide.height} zIndex={39} mirror />
    </>
  );
}

function LoungeScene({ lounge }: { lounge: SceneLounge }) {
  const sofaFront = scaledAsset(FURNITURE.sofaFront, 2.15);
  const sofaSide = scaledAsset(FURNITURE.sofaSide, 2.15);
  const plant = scaledAsset(FURNITURE.plant2, 2.2);

  return (
    <>
      <RoomHeader x={PIXEL_SCENE_LAYOUT.loungeX + 12} y={PIXEL_SCENE_LAYOUT.loungeY} title={lounge.label} />
      <Sprite src={FURNITURE.sofaFront.src} x={PIXEL_SCENE_LAYOUT.loungeX + 176} y={PIXEL_SCENE_LAYOUT.loungeY + 8} width={sofaFront.width} height={sofaFront.height} zIndex={30} />
      <Sprite src={FURNITURE.sofaFront.src} x={PIXEL_SCENE_LAYOUT.loungeX + 324} y={PIXEL_SCENE_LAYOUT.loungeY + 8} width={sofaFront.width} height={sofaFront.height} zIndex={30} />
      <Sprite src={FURNITURE.sofaSide.src} x={PIXEL_SCENE_LAYOUT.loungeX + 22} y={PIXEL_SCENE_LAYOUT.loungeY + 36} width={sofaSide.width} height={sofaSide.height} zIndex={33} />
      <Sprite src={FURNITURE.sofaSide.src} x={PIXEL_SCENE_LAYOUT.loungeX + PIXEL_SCENE_LAYOUT.loungeWidth - 22 - sofaSide.width} y={PIXEL_SCENE_LAYOUT.loungeY + 36} width={sofaSide.width} height={sofaSide.height} zIndex={33} mirror />
      <Sprite src={FURNITURE.plant2.src} x={PIXEL_SCENE_LAYOUT.loungeX + 126} y={PIXEL_SCENE_LAYOUT.loungeY + 14} width={plant.width} height={plant.height} zIndex={34} />
      <Sprite src={FURNITURE.plant2.src} x={PIXEL_SCENE_LAYOUT.loungeX + 332} y={PIXEL_SCENE_LAYOUT.loungeY + 18} width={plant.width} height={plant.height} zIndex={34} />
    </>
  );
}

function roomFacing(agent: SceneAgent) {
  if (agent.anim === "type" || agent.anim === "celebrate") return "up" as PixelCharFacing;
  if (agent.anim === "walk") return agent.flip ? "left" : "right";
  if (agent.anim === "sleep") return "down" as PixelCharFacing;
  if (agent.y < PIXEL_SCENE_LAYOUT.stationAreaY + PIXEL_SCENE_LAYOUT.stationAreaHeight) return "up" as PixelCharFacing;
  return "down" as PixelCharFacing;
}

export function PixelOfficeScene({
  frame,
  bossRoom,
  archiveRoom,
  lounge,
  taskStations,
  agents,
}: {
  frame: number;
  bossRoom: SceneBossRoom;
  archiveRoom: SceneArchiveRoom;
  lounge: SceneLounge;
  taskStations: SceneTaskStation[];
  agents: SceneAgent[];
}) {
  return (
    <div className="relative size-full overflow-hidden bg-[linear-gradient(180deg,#c7ad90,#b89a7d)]">
      <RoomWallBand x={PIXEL_SCENE_LAYOUT.bossRoomX} y={PIXEL_SCENE_LAYOUT.bossRoomY} width={PIXEL_SCENE_LAYOUT.bossRoomWidth} />
      <RoomWallBand x={PIXEL_SCENE_LAYOUT.archiveRoomX} y={PIXEL_SCENE_LAYOUT.archiveRoomY} width={PIXEL_SCENE_LAYOUT.archiveRoomWidth} />
      <RoomWallBand x={PIXEL_SCENE_LAYOUT.routePanelX} y={PIXEL_SCENE_LAYOUT.routePanelY} width={PIXEL_SCENE_LAYOUT.routePanelWidth} />
      <RoomSideCap x={PIXEL_SCENE_LAYOUT.bossRoomX} y={PIXEL_SCENE_LAYOUT.bossRoomY} side="left" />
      <RoomSideCap x={PIXEL_SCENE_LAYOUT.bossRoomX + PIXEL_SCENE_LAYOUT.bossRoomWidth - FLOOR_TILE / 2} y={PIXEL_SCENE_LAYOUT.bossRoomY} side="right" />
      <RoomSideCap x={PIXEL_SCENE_LAYOUT.archiveRoomX} y={PIXEL_SCENE_LAYOUT.archiveRoomY} side="left" />
      <RoomSideCap x={PIXEL_SCENE_LAYOUT.archiveRoomX + PIXEL_SCENE_LAYOUT.archiveRoomWidth - FLOOR_TILE / 2} y={PIXEL_SCENE_LAYOUT.archiveRoomY} side="right" />
      <RoomSideCap x={PIXEL_SCENE_LAYOUT.routePanelX} y={PIXEL_SCENE_LAYOUT.routePanelY} side="left" />
      <RoomSideCap x={PIXEL_SCENE_LAYOUT.routePanelX + PIXEL_SCENE_LAYOUT.routePanelWidth - FLOOR_TILE / 2} y={PIXEL_SCENE_LAYOUT.routePanelY} side="right" />

      <FloorArea x={0} y={0} width={PIXEL_SCENE_LAYOUT.width} height={PIXEL_SCENE_LAYOUT.height} texture={FLOOR_ASSETS.main} zIndex={1} />
      <FloorArea x={PIXEL_SCENE_LAYOUT.bossRoomX} y={PIXEL_SCENE_LAYOUT.bossRoomY + 28} width={PIXEL_SCENE_LAYOUT.bossRoomWidth} height={PIXEL_SCENE_LAYOUT.bossRoomHeight - 28} texture={FLOOR_ASSETS.rooms} zIndex={3} insetBorder />
      <FloorArea x={PIXEL_SCENE_LAYOUT.archiveRoomX} y={PIXEL_SCENE_LAYOUT.archiveRoomY + 28} width={PIXEL_SCENE_LAYOUT.archiveRoomWidth} height={PIXEL_SCENE_LAYOUT.archiveRoomHeight - 28} texture={FLOOR_ASSETS.archive} zIndex={3} insetBorder />
      <FloorArea
        x={PIXEL_SCENE_LAYOUT.routePanelX}
        y={PIXEL_SCENE_LAYOUT.routePanelY + 28}
        width={PIXEL_SCENE_LAYOUT.routePanelWidth}
        height={PIXEL_SCENE_LAYOUT.routePanelHeight}
        texture={FLOOR_ASSETS.rooms}
        zIndex={3}
        insetBorder
      />
      <FloorArea x={PIXEL_SCENE_LAYOUT.loungeX} y={PIXEL_SCENE_LAYOUT.loungeY} width={PIXEL_SCENE_LAYOUT.loungeWidth} height={PIXEL_SCENE_LAYOUT.loungeHeight} texture={FLOOR_ASSETS.lounge} zIndex={3} insetBorder />

      {Array.from({ length: 3 }).map((_, index) => (
        <WallTile key={`boss-left-${index}`} x={PIXEL_SCENE_LAYOUT.bossRoomX} y={PIXEL_SCENE_LAYOUT.bossRoomY + FLOOR_TILE + index * FLOOR_TILE} tileX={0} tileY={2} width={FLOOR_TILE / 2} />
      ))}
      {Array.from({ length: 3 }).map((_, index) => (
        <WallTile key={`boss-right-${index}`} x={PIXEL_SCENE_LAYOUT.bossRoomX + PIXEL_SCENE_LAYOUT.bossRoomWidth - FLOOR_TILE / 2} y={PIXEL_SCENE_LAYOUT.bossRoomY + FLOOR_TILE + index * FLOOR_TILE} tileX={3} tileY={2} width={FLOOR_TILE / 2} />
      ))}
      {Array.from({ length: 3 }).map((_, index) => (
        <WallTile key={`archive-left-${index}`} x={PIXEL_SCENE_LAYOUT.archiveRoomX} y={PIXEL_SCENE_LAYOUT.archiveRoomY + FLOOR_TILE + index * FLOOR_TILE} tileX={0} tileY={2} width={FLOOR_TILE / 2} />
      ))}
      {Array.from({ length: 3 }).map((_, index) => (
        <WallTile key={`archive-right-${index}`} x={PIXEL_SCENE_LAYOUT.archiveRoomX + PIXEL_SCENE_LAYOUT.archiveRoomWidth - FLOOR_TILE / 2} y={PIXEL_SCENE_LAYOUT.archiveRoomY + FLOOR_TILE + index * FLOOR_TILE} tileX={3} tileY={2} width={FLOOR_TILE / 2} />
      ))}
      {Array.from({ length: 3 }).map((_, index) => (
        <WallTile key={`ops-left-${index}`} x={PIXEL_SCENE_LAYOUT.routePanelX} y={PIXEL_SCENE_LAYOUT.routePanelY + FLOOR_TILE + index * FLOOR_TILE} tileX={0} tileY={2} width={FLOOR_TILE / 2} />
      ))}
      {Array.from({ length: 3 }).map((_, index) => (
        <WallTile key={`ops-right-${index}`} x={PIXEL_SCENE_LAYOUT.routePanelX + PIXEL_SCENE_LAYOUT.routePanelWidth - FLOOR_TILE / 2} y={PIXEL_SCENE_LAYOUT.routePanelY + FLOOR_TILE + index * FLOOR_TILE} tileX={3} tileY={2} width={FLOOR_TILE / 2} />
      ))}
      {Array.from({ length: 3 }).map((_, index) => (
        <WallTile
          key={`lounge-left-${index}`}
          x={PIXEL_SCENE_LAYOUT.loungeX}
          y={PIXEL_SCENE_LAYOUT.loungeY + index * FLOOR_TILE}
          tileX={0}
          tileY={2}
          width={FLOOR_TILE / 2}
        />
      ))}
      {Array.from({ length: 3 }).map((_, index) => (
        <WallTile
          key={`lounge-right-${index}`}
          x={PIXEL_SCENE_LAYOUT.loungeX + PIXEL_SCENE_LAYOUT.loungeWidth - FLOOR_TILE / 2}
          y={PIXEL_SCENE_LAYOUT.loungeY + index * FLOOR_TILE}
          tileX={3}
          tileY={2}
          width={FLOOR_TILE / 2}
        />
      ))}

      <StaticOfficeFurniture bossRoom={bossRoom} archiveRoom={archiveRoom} />

      {taskStations.map((station, index) => (
        <DeskStation key={station.id} station={station} index={index} total={Math.max(1, taskStations.length)} frame={frame} />
      ))}

      <LoungeScene lounge={lounge} />

      <Sprite src={FURNITURE.bin.src} x={62} y={490} width={36} height={36} zIndex={18} />
      <Sprite
        src={FURNITURE.paintingSmall2.src}
        x={PIXEL_SCENE_LAYOUT.loungeX + 286}
        y={PIXEL_SCENE_LAYOUT.loungeY + 12}
        width={36}
        height={72}
        zIndex={32}
      />
      <Sprite src={FURNITURE.plant.src} x={658} y={344} width={36} height={72} zIndex={18} />

      {agents.map((agent) => (
        <div key={agent.id}>
          <PixelOfficeChar
            x={agent.x}
            y={agent.y}
            color={agent.color}
            anim={agent.anim}
            frame={frame}
            flip={agent.flip}
            facing={roomFacing(agent)}
            variantKey={agent.id}
            size={1.08}
            worldWidth={PIXEL_SCENE_LAYOUT.width}
            worldHeight={PIXEL_SCENE_LAYOUT.height}
          />
        </div>
      ))}
    </div>
  );
}
