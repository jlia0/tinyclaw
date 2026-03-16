"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, FileText, FolderOpen, RefreshCw } from "lucide-react";
export function MemoryTab({
  memoryIndex,
  memoryFiles,
  memoryDir,
  onRefresh,
}: {
  memoryIndex: string;
  memoryFiles: { name: string; path: string }[];
  memoryDir: string;
  onRefresh: () => void;
}) {
  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Agent Memory
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-auto py-0 px-1 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={onRefresh}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-secondary/50 border">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              Memory files loaded from{" "}
              <code className="bg-muted px-1 py-0.5 font-mono text-[10px]">
                {memoryDir || `memory/`}
              </code>{" "}
              in the agent workspace.
            </p>
          </div>

          {/* Memory index */}
          {memoryIndex ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Memory Index
              </label>
              <div className="p-5 bg-card border font-mono text-xs whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {memoryIndex}
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-muted-foreground">
              <Brain className="h-6 w-6 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No memories yet</p>
              <p className="text-xs mt-1">
                The agent will build memories as it works using the memory
                skill.
              </p>
            </div>
          )}

          {/* File listing */}
          {memoryFiles.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Memory Files ({memoryFiles.length})
              </label>
              <div className="border divide-y">
                {memoryFiles.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 px-3 py-2 text-xs"
                  >
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-mono text-muted-foreground">
                      {file.path}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
