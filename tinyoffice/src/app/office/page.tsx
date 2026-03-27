"use client";

import { useState } from "react";

import { PixelOfficeScene, PIXEL_SCENE_LAYOUT } from "@/components/office/pixel-office-scene";
import { ArchivePanel, type ArchivePanelId } from "@/components/office/archive-panel";
import { ConversationPanel } from "@/components/office/conversation-panel";
import { OverlayBubbles } from "@/components/office/overlay-bubbles";
import { ARCHIVE_BUTTONS } from "@/components/office/types";
import { useOfficeData } from "@/components/office/use-office-data";
import { useOfficeSse } from "@/components/office/use-office-sse";
import { useSceneLayout } from "@/components/office/use-scene-layout";

export default function OfficePage() {
  const data = useOfficeData();
  const sse = useOfficeSse();
  const scene = useSceneLayout({ ...data, ...sse });

  const [archivePanel, setArchivePanel] = useState<ArchivePanelId | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden bg-[#3b3a37] p-3">
        <div className="relative size-full overflow-hidden border border-[#725844] bg-[linear-gradient(180deg,#ccb294,#b89b7d)] shadow-[0_22px_60px_rgba(28,18,12,0.32)]">
          <PixelOfficeScene
            frame={sse.clock.frame}
            bossRoom={scene.bossRoomModel}
            archiveRoom={scene.archiveRoomModel}
            lounge={scene.loungeModel}
            taskStations={scene.taskStations}
            agents={scene.sceneAgents}
          />

          <div
            className="absolute z-[90] grid grid-cols-2 gap-1.5"
            style={{
              left: `${((PIXEL_SCENE_LAYOUT.archiveRoomX + 36) / PIXEL_SCENE_LAYOUT.width) * 100}%`,
              top: `${((PIXEL_SCENE_LAYOUT.archiveRoomY + 36) / PIXEL_SCENE_LAYOUT.height) * 100}%`,
              width: `${(152 / PIXEL_SCENE_LAYOUT.width) * 100}%`,
            }}
          >
            {ARCHIVE_BUTTONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setArchivePanel((current) => (current === item.id ? null : item.id))}
                className={`flex h-[28px] w-full items-center justify-center border px-2 py-1 text-center font-mono text-[10px] leading-none shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] transition ${
                  archivePanel === item.id
                    ? "border-[#465e14] bg-[#111111] text-[#a3e635]"
                    : "border-[#885c47] bg-[#dcc3a3] text-[#5c4637] hover:border-[#465e14] hover:bg-[#111111] hover:text-[#a3e635]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {archivePanel && (
            <ArchivePanel
              panel={archivePanel}
              onClose={() => setArchivePanel(null)}
              logs={data.logs}
              settings={data.settings}
              agentEntries={scene.agentEntries}
              taskSummaries={scene.taskSummaries}
              responseItems={scene.responseItems}
              routeRoot={scene.routeRoot}
              routeTargets={scene.routeTargets}
            />
          )}

          <ConversationPanel
            agents={data.agents}
            agentEntries={scene.agentEntries}
            agentHistories={data.agentHistories}
            bubbles={sse.bubbles}
          />

          <OverlayBubbles bubbles={scene.overlayBubbles} />
        </div>
      </div>
    </div>
  );
}
