"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { checkConnection, getApiBase, setApiBase } from "@/lib/api";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Wifi, WifiOff, RotateCw } from "lucide-react";

export default function ConnectPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "fail">("idle");

  useEffect(() => {
    setUrl(getApiBase());
    // Auto-check on mount
    handleCheck(getApiBase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCheck(baseUrl?: string) {
    const target = baseUrl ?? url;
    setChecking(true);
    setStatus("idle");
    const ok = await checkConnection(target);
    setChecking(false);
    setStatus(ok ? "ok" : "fail");
    if (ok) {
      // Persist the working URL if it differs from env default
      if (!process.env.NEXT_PUBLIC_API_URL || target !== process.env.NEXT_PUBLIC_API_URL) {
        setApiBase(target);
      }
      router.replace("/");
    }
  }

  function handleReset() {
    setApiBase(null);
    const defaultUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777";
    setUrl(defaultUrl);
    handleCheck(defaultUrl);
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 space-y-6">
          <div className="text-center space-y-2">
            {status === "fail" ? (
              <WifiOff className="h-12 w-12 text-destructive mx-auto" />
            ) : (
              <Wifi className="h-12 w-12 text-muted-foreground mx-auto" />
            )}
            <CardTitle className="text-xl">Connect to TinyClaw</CardTitle>
            <CardDescription>
              TinyOffice needs a running TinyClaw API server to work.
            </CardDescription>
          </div>

          {status === "fail" && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-sm space-y-2">
              <p className="font-medium text-destructive">Cannot reach the API server</p>
              <p className="text-muted-foreground">
                Make sure TinyClaw is installed and running:
              </p>
              <pre className="bg-muted rounded px-2 py-1 text-xs overflow-x-auto">
                tinyclaw start{"\n"}# or for first-time web setup:{"\n"}tinyclaw start --skip-setup
              </pre>
              <p className="text-muted-foreground text-xs">
                <a
                  href="https://github.com/TinyAGI/tinyclaw#-quick-start"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Installation guide
                </a>
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="api-url">
              API Server URL
            </label>
            <div className="flex gap-2">
              <Input
                id="api-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:3777"
                onKeyDown={(e) => e.key === "Enter" && handleCheck()}
              />
              <Button onClick={() => handleCheck()} disabled={checking || !url}>
                {checking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="h-4 w-4" />
                )}
              </Button>
            </div>
            {url !== (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777") && (
              <button
                onClick={handleReset}
                className="text-xs text-muted-foreground hover:text-primary"
              >
                Reset to default
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
