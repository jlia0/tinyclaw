import { pointToPercent } from "./pixel-office-scene";
import type { OverlayBubble } from "./types";

export function OverlayBubbles({ bubbles }: { bubbles: OverlayBubble[] }) {
  return (
    <>
      {bubbles.map((bubble) => {
        const position = pointToPercent(bubble.x, bubble.y);
        return (
          <div
            key={bubble.id}
            className={`absolute z-50 h-[76px] w-[192px] -translate-x-1/2 animate-slide-up ${
              bubble.heading === "boss command" ? "" : "-translate-y-full"
            }`}
            style={{ left: position.left, top: position.top }}
          >
            <div
              className="relative flex h-full w-full flex-col border px-2.5 py-2 text-[10px] leading-relaxed text-white shadow-xl"
              style={{ borderColor: bubble.color, background: "rgba(17, 24, 39, 0.94)" }}
            >
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: bubble.color }}>
                {bubble.heading}
              </div>
              <p className="line-clamp-2 break-words overflow-hidden text-ellipsis">{bubble.message}</p>
              {bubble.heading === "boss command" ? (
                <div
                  className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t"
                  style={{ borderColor: bubble.color, background: "rgba(17, 24, 39, 0.94)" }}
                />
              ) : (
                <div
                  className="absolute left-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r border-b"
                  style={{ borderColor: bubble.color, background: "rgba(17, 24, 39, 0.94)" }}
                />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
