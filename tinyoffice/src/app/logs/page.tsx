"use client";

import { useState } from "react";
import { usePolling, useSSE, timeAgo } from "@/lib/hooks";
import { getLogs, type EventData } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Activity, RefreshCw } from "lucide-react";

export default function LogsPage() {
  const [tab, setTab] = useState<"logs" | "events">("logs");
  const { data: logs, refresh: refreshLogs } = usePolling<{ lines: string[] }>(
    () => getLogs(200),
    5000
  );
  const { events } = useSSE(100);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-primary" />
            Logs & Events
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Queue processor logs and system events
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshLogs()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="flex gap-1 border-b">
        <button
          onClick={() => setTab("logs")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "logs"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ScrollText className="h-3.5 w-3.5 inline mr-1.5" />
          Logs
        </button>
        <button
          onClick={() => setTab("events")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "events"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Activity className="h-3.5 w-3.5 inline mr-1.5" />
          Events
          {events.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              {events.length}
            </Badge>
          )}
        </button>
      </div>

      {tab === "logs" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Queue Processor Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
              {logs && logs.lines.length > 0 ? (
                <pre className="text-xs font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {logs.lines.map((line, i) => (
                    <LogLine key={i} line={line} />
                  ))}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No logs yet
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">System Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto space-y-2">
              {events.length > 0 ? (
                events.map((event, i) => (
                  <EventEntry key={`${event.timestamp}-${i}`} event={event} />
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No events yet
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogLine({ line }: { line: string }) {
  let levelClass = "text-muted-foreground";
  if (line.includes("[ERROR]")) levelClass = "text-destructive";
  else if (line.includes("[WARN]")) levelClass = "text-yellow-500";
  else if (line.includes("[INFO]") && line.includes("\u2713")) levelClass = "text-emerald-500";

  return (
    <div className={`${levelClass} py-0.5 border-b border-border/20`}>
      {line}
    </div>
  );
}

function EventEntry({ event }: { event: EventData }) {
  const typeColors: Record<string, string> = {
    message_received: "bg-blue-500",
    agent_routed: "bg-primary",
    chain_step_start: "bg-yellow-500",
    chain_step_done: "bg-green-500",
    response_ready: "bg-emerald-500",
    team_chain_start: "bg-purple-500",
    team_chain_end: "bg-purple-400",
    chain_handoff: "bg-orange-500",
    processor_start: "bg-primary",
    message_enqueued: "bg-cyan-500",
  };

  return (
    <div className="flex items-start gap-3 border-b border-border/50 pb-2">
      <div className={`mt-1.5 h-2 w-2 shrink-0 ${typeColors[event.type] || "bg-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] font-mono">
            {event.type}
          </Badge>
          {event.agentId ? (
            <Badge variant="secondary" className="text-[10px]">@{String(event.agentId)}</Badge>
          ) : null}
          {event.teamId ? (
            <Badge variant="secondary" className="text-[10px]">team:{String(event.teamId)}</Badge>
          ) : null}
        </div>
        {event.responseText ? (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
            {String(event.responseText).substring(0, 300)}
          </p>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {timeAgo(event.timestamp)}
      </span>
    </div>
  );
}
