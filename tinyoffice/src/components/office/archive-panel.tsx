import type { AgentConfig, Settings } from "@/lib/api";
import type { SceneResponseItem, SceneRouteTarget, SceneTaskSummary } from "@/components/pixel-office-scene";

export type ArchivePanelId = "logs" | "workspace" | "outgoing" | "routing" | "tasks";

type ArchivePanelProps = {
  panel: ArchivePanelId;
  onClose: () => void;
  logs: { lines: string[] } | null;
  settings: Settings | null;
  agentEntries: [string, AgentConfig][];
  taskSummaries: SceneTaskSummary[];
  responseItems: SceneResponseItem[];
  routeRoot: string;
  routeTargets: SceneRouteTarget[];
};

export function ArchivePanel({
  panel,
  onClose,
  logs,
  settings,
  agentEntries,
  taskSummaries,
  responseItems,
  routeRoot,
  routeTargets,
}: ArchivePanelProps) {
  return (
    <div className="absolute inset-y-6 right-4 z-[80] w-[380px] border border-stone-700 bg-stone-950/95 shadow-2xl">
      <div className="flex items-center justify-between border-b border-stone-800 px-4 py-3">
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-lime-300">
          {panel === "logs" && "Logs"}
          {panel === "workspace" && "Workspace"}
          {panel === "tasks" && "Task Board"}
          {panel === "outgoing" && "Outgoing Dock"}
          {panel === "routing" && "Live Routing"}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="border border-stone-700 px-2 py-1 font-mono text-[10px] text-stone-300 transition hover:border-lime-500 hover:text-lime-300"
        >
          Close
        </button>
      </div>
      <div className="max-h-[calc(100%-52px)] overflow-auto p-4">
        {panel === "logs" && (
          <div className="space-y-2 font-mono text-xs text-stone-300">
            {(logs?.lines ?? []).length > 0 ? (
              (logs?.lines ?? []).map((line, index) => (
                <div key={`${index}-${line.slice(0, 12)}`} className="border border-stone-800 bg-stone-900/90 px-3 py-2 break-words">
                  {line}
                </div>
              ))
            ) : (
              <div className="border border-stone-800 bg-stone-900/90 px-3 py-2 text-stone-500">No logs yet</div>
            )}
          </div>
        )}

        {panel === "workspace" && (
          <div className="space-y-3 font-mono text-xs text-stone-300">
            <div className="border border-stone-800 bg-stone-900/90 px-3 py-2">
              workspace: {settings?.workspace?.path || settings?.workspace?.name || "not configured"}
            </div>
            {agentEntries.map(([agentId, agent]) => (
              <div key={agentId} className="border border-stone-800 bg-stone-900/90 px-3 py-2">
                <div className="text-lime-300">@{agentId}</div>
                <div className="mt-1 break-all text-stone-400">{agent.working_directory || "no working directory"}</div>
              </div>
            ))}
          </div>
        )}

        {panel === "tasks" && (
          <div className="grid grid-cols-2 gap-3 font-mono text-xs text-stone-300">
            {taskSummaries.map((summary) => (
              <div key={summary.label} className="border border-stone-800 bg-stone-900/90 px-3 py-3">
                <div className="text-stone-500">{summary.label}</div>
                <div className="mt-2 text-xl text-lime-300">{summary.count}</div>
              </div>
            ))}
          </div>
        )}

        {panel === "outgoing" && (
          <div className="space-y-2 font-mono text-xs text-stone-300">
            {responseItems.length > 0 ? (
              responseItems.map((response) => (
                <div key={response.id} className="border border-stone-800 bg-stone-900/90 px-3 py-2">
                  <div className="text-lime-300">{response.label}</div>
                  <div className="mt-1 text-stone-500">{response.subtitle}</div>
                </div>
              ))
            ) : (
              <div className="border border-stone-800 bg-stone-900/90 px-3 py-2 text-stone-500">No outgoing responses</div>
            )}
          </div>
        )}

        {panel === "routing" && (
          <div className="space-y-3 font-mono text-xs text-stone-300">
            <div className="border border-stone-800 bg-stone-900/90 px-3 py-2">
              <div className="text-stone-500">root</div>
              <div className="mt-1 text-lime-300">{routeRoot}</div>
            </div>
            {routeTargets.length > 0 ? (
              routeTargets.map((target) => (
                <div key={`${target.label}-${target.state}`} className="border border-stone-800 bg-stone-900/90 px-3 py-2">
                  <div style={{ color: target.color }}>{target.label}</div>
                  <div className="mt-1 text-stone-500">{target.state}</div>
                </div>
              ))
            ) : (
              <div className="border border-stone-800 bg-stone-900/90 px-3 py-2 text-stone-500">No active route</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
