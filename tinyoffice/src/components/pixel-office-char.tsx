import type { ReactNode } from "react";

export type PixelCharAnim = "idle" | "walk" | "type" | "celebrate" | "error" | "sleep";

type PixelOfficeCharProps = {
  x: number;
  y: number;
  color: string;
  anim: PixelCharAnim;
  frame: number;
  flip?: boolean;
  hat?: boolean;
  size?: number;
};

const PX = 3;

const PALETTE: Record<string, string> = {
  O: "#2a1518",
  H: "#8f6439",
  L: "#b18649",
  S: "#e9a384",
  s: "#fbbf97",
  F: "#c5896e",
  E: "#000000",
  W: "#ffffff",
  g: "#4f4f4f",
  P: "#0f3052",
  p: "#1a4a7a",
  K: "#040605",
  N: "#493e38",
};

const HEAD_ROWS = [
  "________________",
  "________________",
  "____OOOOOOO_____",
  "___OHHHLOHHO____",
  "__OHHHHLHHHHHHO_",
  "_OLHHHHHOHHHHO__",
  "_OLHHHHHHHHHO___",
  "_OLHHHHHHHHHO___",
  "_OLHHHHHHHHHO___",
  "_OLHHHHHHHHHO___",
  "_OHHHLLLOHLHO___",
  "_OHHHHOOHOHHHO__",
  "_OHHOOSSPSSOO___",
  "__OOSSESSESOo___",
  "___NsWESSEWsN___",
  "___NsWgSSgWsN___",
  "____NFsSSsFN____",
];

const ARMS_IDLE = [
  "___NCNNSSNNDN___",
  "__NCDDDWKKWDDN__",
  "__NDDDWKKWDDCN__",
  "__sWDDWKKWNSSN__",
  "__NSNDDWKKWSFN__",
];

const ARMS_TYPE = [
  "___NCNNSSNNDN___",
  "__NCDDDWKKWDDN__",
  "_NDDDWKKKKWDDNs_",
  "_NSSsDDWKKWNSsN_",
  "_NsSSNDKKKKNSSN_",
];

const ARMS_CELEBRATE = [
  "sNNNCNNSSNNCNNs_",
  "NsNCDDDWKKWDDsN_",
  "___NDDDWKKWDDD__",
  "__ssDDDWKKWNss__",
  "___NSNKKKKKNSN__",
];

const ARMS_SLEEP = [
  "___NCNNSSNNDN___",
  "__NCDDDWKKWDDN__",
  "__NDDDKKKKKDDNs_",
  "__NSDDKKKKKNSp__",
  "___SpNpppppNS___",
];

const LEGS_IDLE = [
  "__NFNpWKKWDNN___",
  "___NNpWWWWpN____",
];

const LEGS_WALK_A = [
  "__NFNpKppKDNN___",
  "___KppK___pKN___",
];

const LEGS_WALK_B = [
  "__NFNpKppKDNN___",
  "___NppK___KpK___",
];

const LEGS_TYPE = [
  "__NFNpWKKWDNN___",
  "___NpKK___KpN___",
];

const LEGS_CELEBRATE = [
  "__NpNpKKKKKpNN__",
  "_NKppK_____KppKN",
];

function colorFor(token: string, shirt: string) {
  if (token === "_") return "transparent";
  if (token === "C") return shirt;
  if (token === "D") {
    const r = parseInt(shirt.slice(1, 3), 16);
    const g = parseInt(shirt.slice(3, 5), 16);
    const b = parseInt(shirt.slice(5, 7), 16);
    return `#${Math.round(r * 0.7).toString(16).padStart(2, "0")}${Math.round(g * 0.7)
      .toString(16)
      .padStart(2, "0")}${Math.round(b * 0.7)
      .toString(16)
      .padStart(2, "0")}`;
  }
  return PALETTE[token] ?? "#ff00ff";
}

function pixelRow(
  row: string,
  rowIndex: number,
  baseX: number,
  baseY: number,
  px: number,
  shirt: string,
  keyPrefix: string,
) {
  const rects: ReactNode[] = [];
  for (let column = 0; column < row.length; column += 1) {
    const token = row[column];
    if (token === "_" || token === " ") continue;
    const normalized = token === "o" ? "O" : token === "G" ? "g" : token;
    rects.push(
      <rect
        key={`${keyPrefix}${rowIndex}_${column}`}
        x={baseX + column * px}
        y={baseY + rowIndex * px}
        width={px}
        height={px}
        fill={colorFor(normalized, shirt)}
      />,
    );
  }
  return rects;
}

export function PixelOfficeChar({
  x,
  y,
  color,
  anim,
  frame,
  flip = false,
  hat = false,
  size = 1,
}: PixelOfficeCharProps) {
  const px = Math.round(PX * size);
  const charWidth = 16 * px;
  const charHeight = 24 * px;
  const walkPhase = Math.floor(frame / 4) % 2 === 0;
  const typeBounce = anim === "type" ? (Math.floor(frame / 3) % 2 === 0 ? -px : 0) : 0;
  const celebrateJump =
    anim === "celebrate" ? Math.round(Math.abs(Math.sin((frame / 10) * Math.PI)) * px * 4) : 0;
  const errorShake = anim === "error" ? (Math.floor(frame / 2) % 2 === 0 ? -px : px) : 0;

  const baseX = x - charWidth / 2 + errorShake;
  const baseY = y - charHeight + typeBounce - celebrateJump;

  const armRows =
    anim === "type"
      ? ARMS_TYPE
      : anim === "celebrate"
        ? ARMS_CELEBRATE
        : anim === "sleep"
          ? ARMS_SLEEP
          : ARMS_IDLE;

  const legRows =
    anim === "walk"
      ? walkPhase
        ? LEGS_WALK_A
        : LEGS_WALK_B
      : anim === "celebrate"
        ? LEGS_CELEBRATE
        : anim === "type"
          ? LEGS_TYPE
          : LEGS_IDLE;

  const pixels: ReactNode[] = [];

  if (hat) {
    pixels.push(
      <rect key="hat-brim" x={baseX + px} y={baseY + px * 2} width={14 * px} height={px * 2} fill={color} />,
      <rect key="hat-body" x={baseX + 3 * px} y={baseY - px * 3} width={10 * px} height={px * 4} fill={color} />,
      <rect key="hat-star" x={baseX + 7 * px} y={baseY - px * 2} width={2 * px} height={2 * px} fill="#f59e0b" />,
    );
  }

  HEAD_ROWS.forEach((row, index) => {
    pixels.push(...pixelRow(row, index, baseX, baseY, px, color, "h"));
  });

  armRows.forEach((row, index) => {
    pixels.push(...pixelRow(row, 17 + index, baseX, baseY, px, color, "a"));
  });

  legRows.forEach((row, index) => {
    pixels.push(...pixelRow(row, 22 + index, baseX, baseY, px, color, "l"));
  });

  return (
    <g transform={flip ? `translate(${x * 2}, 0) scale(-1, 1)` : undefined}>
      <ellipse cx={x} cy={y + px} rx={charWidth * 0.32} ry={px * 1.4} fill="#0b1020" opacity={0.35} />
      {pixels}
    </g>
  );
}
