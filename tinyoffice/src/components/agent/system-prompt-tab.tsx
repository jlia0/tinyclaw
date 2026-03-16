"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FileText, FolderOpen, Loader2, Save, Check } from "lucide-react";

export function SystemPromptTab({
  content,
  filePath,
  loaded,
  onChange,
  onSave,
  saving,
  saved,
}: {
  content: string;
  filePath: string;
  loaded: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            System Prompt
            <span className="text-[10px] text-muted-foreground font-normal">
              AGENTS.md
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-secondary/50 border">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              Loaded from{" "}
              <code className="bg-muted px-1 py-0.5 font-mono text-[10px]">
                {filePath || "AGENTS.md"}
              </code>{" "}
              in the agent workspace. Changes are saved back to this file.
            </p>
          </div>

          {!loaded ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading...</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Agent Instructions
              </label>
              <p className="text-[11px] text-muted-foreground/70 mb-2">
                This is the agent&apos;s AGENTS.md file — it defines behavior,
                team communication, memory index, and other persistent
                instructions.
              </p>
              <Textarea
                value={content}
                onChange={(e) => onChange(e.target.value)}
                placeholder="# Agent Instructions&#10;&#10;Define this agent's behavior and instructions..."
                rows={28}
                className="text-sm font-mono"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {content.length} characters &middot;{" "}
                  {content.split("\n").length} lines
                </span>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
