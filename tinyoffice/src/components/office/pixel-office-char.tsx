import type { CSSProperties } from "react";

export type PixelCharAnim = "idle" | "walk" | "type" | "celebrate" | "error" | "sleep";
export type PixelCharFacing = "down" | "up" | "right" | "left";

type PixelOfficeCharProps = {
  x: number;
  y: number;
  color: string;
  anim: PixelCharAnim;
  frame: number;
  flip?: boolean;
  size?: number;
  variantKey?: string;
  facing?: PixelCharFacing;
  worldWidth?: number;
  worldHeight?: number;
};

const SPRITE_WIDTH = 16;
const SPRITE_HEIGHT = 32;
const SHEET_COLUMNS = 7;
const SHEET_ROWS = 3;
const CHARACTER_VARIANTS = 6;
const DEFAULT_WORLD_WIDTH = 1280;
const DEFAULT_WORLD_HEIGHT = 720;

function hashKey(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function spriteFrame(anim: PixelCharAnim, frame: number) {
  if (anim === "walk") {
    const frames = [0, 1, 2, 1];
    return frames[Math.abs(frame) % frames.length];
  }
  if (anim === "type" || anim === "celebrate") {
    return 3 + (Math.abs(frame) % 2);
  }
  if (anim === "sleep") {
    return 3;
  }
  if (anim === "error") {
    return 4 + (Math.abs(frame) % 2);
  }
  return 3;
}

function spriteRow(facing: PixelCharFacing) {
  if (facing === "up") return 1;
  if (facing === "left" || facing === "right") return 2;
  return 0;
}

function bobOffset(anim: PixelCharAnim, frame: number, scale: number) {
  const unit = Math.max(1, scale * 1.35);
  if (anim === "walk") return (frame % 2 === 0 ? 0 : -unit) - unit * 0.25;
  if (anim === "type") return frame % 2 === 0 ? 0 : -unit * 0.75;
  if (anim === "celebrate") return -unit * (1.2 + Math.abs(Math.sin(frame / 3)) * 1.8);
  return 0;
}

function shakeOffset(anim: PixelCharAnim, frame: number, scale: number) {
  if (anim !== "error") return 0;
  const unit = Math.max(1, scale);
  return frame % 2 === 0 ? -unit : unit;
}

function toPercent(value: number, total: number) {
  return `${(value / total) * 100}%`;
}

export function PixelOfficeChar({
  x,
  y,
  color,
  anim,
  frame,
  flip = false,
  size = 1,
  variantKey,
  facing = "down",
  worldWidth = DEFAULT_WORLD_WIDTH,
  worldHeight = DEFAULT_WORLD_HEIGHT,
}: PixelOfficeCharProps) {
  const scale = 2.2 * size;
  const width = SPRITE_WIDTH * scale;
  const height = SPRITE_HEIGHT * scale;
  const variant = hashKey(variantKey ?? color) % CHARACTER_VARIANTS;
  const frameIndex = spriteFrame(anim, frame);
  const rowIndex = spriteRow(facing);
  const mirror = flip || facing === "left";
  const bob = bobOffset(anim, frame, scale);
  const shake = shakeOffset(anim, frame, scale);
  const left = x - width / 2 + shake;
  const top = y - height + bob;
  const shadowTop = y - scale * 2;
  const shadowWidth = width * 0.62;
  const shadowHeight = Math.max(6, scale * 4.8);

  const spriteStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    backgroundImage: `url(/assets/pixel-agents/characters/char_${variant}.png)`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${SHEET_COLUMNS * 100}% ${SHEET_ROWS * 100}%`,
    backgroundPosition: `${(frameIndex / (SHEET_COLUMNS - 1)) * 100}% ${(rowIndex / (SHEET_ROWS - 1)) * 100}%`,
    imageRendering: "pixelated",
    transform: mirror ? "scaleX(-1)" : undefined,
    transformOrigin: "center",
    filter:
      anim === "error"
        ? "drop-shadow(0 0 10px rgba(239,68,68,0.45))"
        : `drop-shadow(0 0 10px color-mix(in srgb, ${color} 38%, transparent))`,
  };

  return (
    <>
      <div
        className="pointer-events-none absolute rounded-full bg-[#120d09]/35 blur-[1px]"
        style={{
          left: toPercent(x - shadowWidth / 2, worldWidth),
          top: toPercent(shadowTop, worldHeight),
          width: toPercent(shadowWidth, worldWidth),
          height: toPercent(shadowHeight, worldHeight),
          zIndex: Math.max(1, Math.round(y * 8)),
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          left: toPercent(left, worldWidth),
          top: toPercent(top, worldHeight),
          width: toPercent(width, worldWidth),
          height: toPercent(height, worldHeight),
          zIndex: Math.max(2, Math.round(y * 10)),
        }}
      >
        <div style={spriteStyle} />
      </div>
    </>
  );
}
