"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  SkillsConstellation,
  type SkillEntry,
} from "@/components/agent/skills-constellation";
import { searchRegistrySkills, installRegistrySkill } from "@/lib/api";
import { RefreshCw, Swords } from "lucide-react";

export function SkillsTab({
  skills,
  agentName,
  agentInitials,
  onRefresh,
  agentId,
}: {
  skills: SkillEntry[];
  agentName: string;
  agentInitials: string;
  onRefresh: () => void;
  agentId: string;
}) {
  const [search, setSearch] = useState("");
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryResults, setRegistryResults] = useState<
    { ref: string; installs?: string; url?: string }[]
  >([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [installingRef, setInstallingRef] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [registryOpen, setRegistryOpen] = useState(false);

  const filtered = skills.filter((s) => {
    if (
      search &&
      !s.name.toLowerCase().includes(search.toLowerCase()) &&
      !s.description.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  const runRegistrySearch = async () => {
    const q = registryQuery.trim();
    if (!q) return;
    setRegistryLoading(true);
    setRegistryError(null);
    setInstallMessage(null);
    try {
      const res = await searchRegistrySkills(agentId, q);
      setRegistryResults(res.results || []);
    } catch (err) {
      setRegistryError((err as Error).message);
      setRegistryResults([]);
    } finally {
      setRegistryLoading(false);
    }
  };

  const handleInstall = async (ref: string) => {
    setInstallingRef(ref);
    setRegistryError(null);
    setInstallMessage(null);
    try {
      await installRegistrySkill(agentId, ref);
      setInstallMessage(`Installed ${ref}.`);
      onRefresh();
    } catch (err) {
      setRegistryError((err as Error).message);
    } finally {
      setInstallingRef(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filters bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b bg-card/50">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
          className="max-w-xs h-8 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRegistryOpen(true)}
        >
          Registry Search
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {filtered.length} skills
          </span>
        </div>
      </div>

      {registryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-3xl bg-card border shadow-lg">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="text-sm font-semibold">Registry Search</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRegistryOpen(false)}
              >
                Close
              </Button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={registryQuery}
                  onChange={(e) => setRegistryQuery(e.target.value)}
                  placeholder="Search skills registry (skills.sh)..."
                  className="flex-1 h-9 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runRegistrySearch();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={runRegistrySearch}
                  disabled={registryLoading || !registryQuery.trim()}
                >
                  {registryLoading ? "Searching..." : "Search"}
                </Button>
              </div>
              {registryError && (
                <div className="text-[11px] text-destructive">
                  {registryError}
                </div>
              )}
              {installMessage && (
                <div className="text-[11px] text-primary">{installMessage}</div>
              )}
              {registryResults.length > 0 && (
                <div className="space-y-2">
                  {registryResults.map((r) => (
                    <div
                      key={r.ref}
                      className="flex items-center gap-3 px-3 py-2 border bg-card/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {r.ref}
                        </div>
                        {r.installs && (
                          <div className="text-[10px] text-muted-foreground">
                            {r.installs} installs
                          </div>
                        )}
                        {r.url && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {r.url}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleInstall(r.ref)}
                        disabled={installingRef === r.ref}
                      >
                        {installingRef === r.ref ? "Installing..." : "Install"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Constellation */}
      {filtered.length > 0 ? (
        <div className="flex-1">
          <SkillsConstellation
            skills={filtered}
            agentName={agentName}
            agentInitials={agentInitials}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Swords className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No skills found in workspace</p>
            <p className="text-xs mt-1">
              Skills are loaded from{" "}
              <code className="bg-muted px-1 py-0.5 text-[10px] font-mono">
                .agents/skills/
              </code>{" "}
              in the agent workspace
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
