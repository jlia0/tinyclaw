"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { HeartPulse, Loader2, Save, Check } from "lucide-react";

export function HeartbeatTab({
  content,
  filePath,
  loaded,
  onChange,
  enabled,
  onToggle,
  interval,
  onIntervalChange,
  onSave,
  saving,
  saved,
}: {
  content: string;
  filePath: string;
  loaded: boolean;
  onChange: (v: string) => void;
  enabled: boolean;
  onToggle: () => void;
  interval: string;
  onIntervalChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  const intervalSec = parseInt(interval) || 300;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-primary" />
            Heartbeat Monitor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Toggle */}
          <div className="flex items-center justify-between p-3 bg-secondary/50 border">
            <div>
              <p className="text-sm font-medium">Heartbeat Enabled</p>
              <p className="text-xs text-muted-foreground">
                Periodically wake the agent to check tasks and process work
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={onToggle} />
          </div>

          {enabled && (
            <>
              {/* Interval */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Interval (seconds)
                </label>
                <Input
                  type="number"
                  value={interval}
                  onChange={(e) => onIntervalChange(e.target.value)}
                  min={30}
                  max={3600}
                  className="max-w-[200px] font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Every{" "}
                  {intervalSec >= 60
                    ? `${Math.floor(intervalSec / 60)}m ${intervalSec % 60 ? `${intervalSec % 60}s` : ""}`
                    : `${intervalSec}s`}{" "}
                  the agent will wake up and execute the heartbeat prompt
                </p>
              </div>

              {/* Heartbeat prompt from file */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Heartbeat Prompt
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    from{" "}
                    <code className="bg-muted px-1 py-0.5 font-mono text-[10px]">
                      {filePath || "heartbeat.md"}
                    </code>
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground/70 mb-2">
                  What should the agent do each heartbeat cycle? Loaded from
                  heartbeat.md in the workspace.
                </p>
                {!loaded ? (
                  <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading...</span>
                  </div>
                ) : (
                  <Textarea
                    value={content}
                    onChange={(e) => onChange(e.target.value)}
                    rows={10}
                    className="text-sm font-mono"
                    placeholder="Check your tasks, process pending work..."
                  />
                )}
              </div>

              {/* Status + Save */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 bg-primary animate-pulse-dot" />
                      <span className="text-xs text-muted-foreground">
                        Active
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/50">
                      |
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Next beat in ~{Math.floor(intervalSec / 2)}s
                    </span>
                  </div>
                  <Button onClick={onSave} disabled={saving} size="sm" className="gap-2">
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : saved ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {saved ? "Saved" : "Save"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
