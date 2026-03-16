"use client";

import { useState, useCallback, useEffect } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FullScreenCalendar,
  type CalendarData,
} from "@/components/ui/fullscreen-calendar";
import {
  getSchedules,
  createSchedule,
  deleteSchedule,
  type Schedule,
} from "@/lib/api";
import {
  CalendarDays,
  CalendarIcon,
  Clock,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

function cronNextOccurrences(cron: string, count: number): Date[] {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return [];

  const [minF, hourF, domF, monF, dowF] = fields;
  const results: Date[] = [];
  const now = new Date();
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);

  function matches(val: number, field: string): boolean {
    if (field === "*") return true;
    for (const part of field.split(",")) {
      if (part.includes("/")) {
        const [base, step] = part.split("/");
        const stepN = parseInt(step);
        const baseN = base === "*" ? 0 : parseInt(base);
        if (stepN > 0 && (val - baseN) % stepN === 0 && val >= baseN) return true;
      } else if (part.includes("-")) {
        const [lo, hi] = part.split("-").map(Number);
        if (val >= lo && val <= hi) return true;
      } else {
        if (parseInt(part) === val) return true;
      }
    }
    return false;
  }

  for (let i = 0; i < 60 * 24 * 90 && results.length < count; i++) {
    cursor.setMinutes(cursor.getMinutes() + 1);
    const min = cursor.getMinutes();
    const hour = cursor.getHours();
    const dom = cursor.getDate();
    const mon = cursor.getMonth() + 1;
    const dow = cursor.getDay();

    if (
      matches(min, minF) &&
      matches(hour, hourF) &&
      matches(dom, domF) &&
      matches(mon, monF) &&
      (matches(dow, dowF) || matches(dow === 0 ? 7 : dow, dowF))
    ) {
      results.push(new Date(cursor));
    }
  }
  return results;
}

type RepeatMode = "once" | "daily" | "weekdays" | "weekly" | "monthly" | "hourly" | "custom";
const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function buildCron(opts: {
  repeat: RepeatMode;
  hour: number;
  minute: number;
  days: number[];
  monthDay: number;
  customCron: string;
  intervalMinutes: number;
}): string {
  switch (opts.repeat) {
    case "once":
      return "";
    case "hourly":
      return opts.intervalMinutes > 0
        ? `*/${opts.intervalMinutes} * * * *`
        : `${opts.minute} * * * *`;
    case "daily":
      return `${opts.minute} ${opts.hour} * * *`;
    case "weekdays":
      return `${opts.minute} ${opts.hour} * * 1-5`;
    case "weekly":
      if (opts.days.length === 0) return `${opts.minute} ${opts.hour} * * *`;
      return `${opts.minute} ${opts.hour} * * ${opts.days.join(",")}`;
    case "monthly":
      return `${opts.minute} ${opts.hour} ${opts.monthDay} * *`;
    case "custom":
      return opts.customCron;
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function describeSchedule(opts: {
  repeat: RepeatMode;
  hour: number;
  minute: number;
  days: number[];
  monthDay: number;
  intervalMinutes: number;
  runAtDate: Date | undefined;
  runAtTime: string;
}): string {
  const timeStr = `${opts.hour % 12 || 12}:${String(opts.minute).padStart(2, "0")} ${opts.hour >= 12 ? "PM" : "AM"}`;
  switch (opts.repeat) {
    case "once": {
      if (!opts.runAtDate) return "Pick a date and time";
      const [hours, minutes] = (opts.runAtTime || "09:00").split(":").map(Number);
      const d = new Date(opts.runAtDate);
      d.setHours(hours, minutes, 0, 0);
      return `Once on ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    }
    case "hourly":
      return opts.intervalMinutes > 0
        ? `Every ${opts.intervalMinutes} minutes`
        : `Every hour at :${String(opts.minute).padStart(2, "0")}`;
    case "daily":
      return `Every day at ${timeStr}`;
    case "weekdays":
      return `Weekdays (Mon-Fri) at ${timeStr}`;
    case "weekly": {
      if (opts.days.length === 0) return `Every day at ${timeStr}`;
      const names = opts.days.map(d => DAYS_OF_WEEK[d]);
      return `Every ${names.join(", ")} at ${timeStr}`;
    }
    case "monthly":
      return `${ordinal(opts.monthDay)} of every month at ${timeStr}`;
    case "custom":
      return "Custom cron expression";
  }
}

export function ScheduleTab({ agentId }: { agentId: string }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [formRepeat, setFormRepeat] = useState<RepeatMode>("daily");
  const [formHour, setFormHour] = useState(9);
  const [formMinute, setFormMinute] = useState(0);
  const [formDays, setFormDays] = useState<number[]>([1]);
  const [formMonthDay, setFormMonthDay] = useState(1);
  const [formIntervalMinutes, setFormIntervalMinutes] = useState(30);
  const [formCustomCron, setFormCustomCron] = useState("");
  const [formRunAtDate, setFormRunAtDate] = useState<Date | undefined>();
  const [formRunAtTime, setFormRunAtTime] = useState("09:00");
  const [formMessage, setFormMessage] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadSchedules = useCallback(() => {
    getSchedules(agentId)
      .then((data) => {
        setSchedules(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const handleCreate = async () => {
    if (!formMessage.trim()) return;

    const isOnce = formRepeat === "once";
    const cron = isOnce ? undefined : buildCron({
      repeat: formRepeat,
      hour: formHour,
      minute: formMinute,
      days: formDays,
      monthDay: formMonthDay,
      customCron: formCustomCron,
      intervalMinutes: formIntervalMinutes,
    });
    let runAt: string | undefined;
    if (isOnce && formRunAtDate) {
      const [hours, minutes] = (formRunAtTime || "09:00").split(":").map(Number);
      const d = new Date(formRunAtDate);
      d.setHours(hours, minutes, 0, 0);
      runAt = d.toISOString();
    }

    if (!isOnce && (!cron || !cron.trim())) return;
    if (isOnce && !runAt) return;

    setFormSaving(true);
    setFormError(null);
    try {
      await createSchedule({
        cron: cron || undefined,
        runAt,
        agentId,
        message: formMessage,
        label: formLabel || undefined,
      });
      setShowForm(false);
      setFormRepeat("daily");
      setFormHour(9);
      setFormMinute(0);
      setFormDays([1]);
      setFormMonthDay(1);
      setFormIntervalMinutes(30);
      setFormCustomCron("");
      setFormRunAtDate(undefined);
      setFormRunAtTime("09:00");
      setFormMessage("");
      setFormLabel("");
      loadSchedules();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSchedule(id);
      loadSchedules();
    } catch { /* ignore */ }
  };

  // Convert schedules to calendar data
  const calendarData: CalendarData[] = [];
  const dayMap = new Map<string, CalendarData>();

  for (const s of schedules) {
    if (!s.enabled) continue;

    if (s.runAt) {
      const occ = new Date(s.runAt);
      const key = occ.toDateString();
      if (!dayMap.has(key)) {
        dayMap.set(key, { day: new Date(occ.getFullYear(), occ.getMonth(), occ.getDate()), events: [] });
      }
      const hours = occ.getHours();
      const mins = occ.getMinutes();
      const ampm = hours >= 12 ? "PM" : "AM";
      const h12 = hours % 12 || 12;
      dayMap.get(key)!.events.push({
        id: s.id,
        name: s.label || s.message.slice(0, 40),
        time: `${h12}:${String(mins).padStart(2, "0")} ${ampm}`,
        datetime: occ.toISOString(),
      });
      continue;
    }

    const occurrences = cronNextOccurrences(s.cron, 60);
    for (const occ of occurrences) {
      const key = occ.toDateString();
      if (!dayMap.has(key)) {
        dayMap.set(key, { day: new Date(occ.getFullYear(), occ.getMonth(), occ.getDate()), events: [] });
      }
      const hours = occ.getHours();
      const mins = occ.getMinutes();
      const ampm = hours >= 12 ? "PM" : "AM";
      const h12 = hours % 12 || 12;
      const timeStr = `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
      dayMap.get(key)!.events.push({
        id: `${s.id}-${occ.getTime()}`,
        name: s.label || s.message.slice(0, 40),
        time: timeStr,
        datetime: occ.toISOString(),
      });
    }
  }
  calendarData.push(...dayMap.values());

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading schedules...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Schedule list bar */}
      {schedules.length > 0 && (
        <div className="flex items-center gap-3 px-6 py-3 border-b bg-card/50">
          <div className="flex items-center gap-2 flex-1 overflow-x-auto">
            {schedules.map((s) => (
              <Badge
                key={s.id}
                variant="outline"
                className="flex items-center gap-2 px-3 py-1.5 text-xs shrink-0"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-primary" : "bg-muted-foreground/30"}`} />
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground font-mono">
                  {s.runAt
                    ? new Date(s.runAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                    : s.cron}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0 ml-1"
                  onClick={() => handleDelete(s.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {schedules.length} schedule(s)
          </span>
        </div>
      )}

      {/* New schedule form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-lg shadow-lg">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <div className="text-sm font-semibold">New Schedule</div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowForm(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <CardContent className="p-5 space-y-5">
              <Input
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="Add title"
                className="text-base font-medium border-0 border-b rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary"
              />

              <Textarea
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder="What should the agent do?"
                rows={2}
                className="text-sm"
              />

              {/* Repeat */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Select value={formRepeat} onValueChange={(v) => setFormRepeat(v as RepeatMode)}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="once">Does not repeat</SelectItem>
                      <SelectItem value="hourly">Every hour</SelectItem>
                      <SelectItem value="daily">Every day</SelectItem>
                      <SelectItem value="weekdays">Every weekday (Mon-Fri)</SelectItem>
                      <SelectItem value="weekly">Weekly on specific days</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="custom">Custom cron</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Date + time picker for one-time events */}
                {formRepeat === "once" && (
                  <div className="flex items-center gap-3">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-[180px] shrink-0 justify-start text-left font-normal",
                            !formRunAtDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="h-4 w-4 mr-2" />
                          {formRunAtDate
                            ? format(formRunAtDate, "MMM d, yyyy")
                            : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={formRunAtDate}
                          onSelect={setFormRunAtDate}
                          disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        />
                      </PopoverContent>
                    </Popover>
                    <div className="flex items-center gap-1.5 text-xs">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <Select
                        value={formRunAtTime.split(":")[0]}
                        onValueChange={(v) => {
                          const mins = formRunAtTime.split(":")[1] || "00";
                          setFormRunAtTime(`${v}:${mins}`);
                        }}
                      >
                        <SelectTrigger className="w-[72px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, i) => {
                            const h12 = i % 12 || 12;
                            const ampm = i >= 12 ? "PM" : "AM";
                            return (
                              <SelectItem key={i} value={String(i).padStart(2, "0")} className="text-xs">
                                {h12} {ampm}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground">:</span>
                      <Select
                        value={formRunAtTime.split(":")[1] || "00"}
                        onValueChange={(v) => {
                          const hrs = formRunAtTime.split(":")[0] || "09";
                          setFormRunAtTime(`${hrs}:${v}`);
                        }}
                      >
                        <SelectTrigger className="w-[60px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                            <SelectItem key={m} value={String(m).padStart(2, "0")} className="text-xs">
                              {String(m).padStart(2, "0")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Time picker for recurring */}
                {formRepeat !== "custom" && formRepeat !== "once" && (
                  <div className="flex items-center gap-3">
                    <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                    {formRepeat === "hourly" ? (
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-sm text-muted-foreground">Every</span>
                        <Select
                          value={String(formIntervalMinutes)}
                          onValueChange={(v) => setFormIntervalMinutes(Number(v))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="15">15 minutes</SelectItem>
                            <SelectItem value="30">30 minutes</SelectItem>
                            <SelectItem value="0">hour (at :{String(formMinute).padStart(2, "0")})</SelectItem>
                          </SelectContent>
                        </Select>
                        {formIntervalMinutes === 0 && (
                          <>
                            <span className="text-sm text-muted-foreground">at</span>
                            <Select
                              value={String(formMinute)}
                              onValueChange={(v) => setFormMinute(Number(v))}
                            >
                              <SelectTrigger className="w-20">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                                  <SelectItem key={m} value={String(m)}>:{String(m).padStart(2, "0")}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-sm text-muted-foreground">at</span>
                        <Select
                          value={String(formHour)}
                          onValueChange={(v) => setFormHour(Number(v))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 24 }, (_, i) => {
                              const h12 = i % 12 || 12;
                              const ampm = i >= 12 ? "PM" : "AM";
                              return <SelectItem key={i} value={String(i)}>{h12} {ampm}</SelectItem>;
                            })}
                          </SelectContent>
                        </Select>
                        <span className="text-sm text-muted-foreground">:</span>
                        <Select
                          value={String(formMinute)}
                          onValueChange={(v) => setFormMinute(Number(v))}
                        >
                          <SelectTrigger className="w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                              <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                {/* Day-of-week toggles for weekly */}
                {formRepeat === "weekly" && (
                  <div className="flex items-center gap-1.5 pl-7">
                    {DAYS_OF_WEEK.map((day, i) => (
                      <Button
                        key={day}
                        type="button"
                        variant={formDays.includes(i) ? "default" : "outline"}
                        size="icon"
                        className="h-8 w-8 rounded-full text-[11px] font-medium"
                        onClick={() =>
                          setFormDays(prev =>
                            prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i].sort()
                          )
                        }
                      >
                        {day.charAt(0)}
                      </Button>
                    ))}
                  </div>
                )}

                {/* Day of month for monthly */}
                {formRepeat === "monthly" && (
                  <div className="flex items-center gap-2 pl-7">
                    <span className="text-sm text-muted-foreground">on day</span>
                    <Select
                      value={String(formMonthDay)}
                      onValueChange={(v) => setFormMonthDay(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 28 }, (_, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>{ordinal(i + 1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Custom cron input */}
                {formRepeat === "custom" && (
                  <div className="pl-7">
                    <Input
                      value={formCustomCron}
                      onChange={(e) => setFormCustomCron(e.target.value)}
                      placeholder="0 9 * * 1-5"
                      className="font-mono text-sm"
                      autoFocus
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      minute hour day-of-month month day-of-week
                    </p>
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {describeSchedule({
                    repeat: formRepeat,
                    hour: formHour,
                    minute: formMinute,
                    days: formDays,
                    monthDay: formMonthDay,
                    intervalMinutes: formIntervalMinutes,
                    runAtDate: formRunAtDate,
                    runAtTime: formRunAtTime,
                  })}
                </p>
              </div>

              {formError && (
                <p className="text-[11px] text-destructive">{formError}</p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={formSaving || !formMessage.trim() || (formRepeat === "custom" && !formCustomCron.trim()) || (formRepeat === "once" && !formRunAtDate)}
                >
                  {formSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Calendar */}
      {schedules.length > 0 ? (
        <div className="flex-1">
          <FullScreenCalendar
            data={calendarData}
            onNewEvent={() => setShowForm(true)}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <CalendarDays className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No schedules configured</p>
            <p className="text-xs mt-1 mb-4">
              Schedules send recurring tasks to this agent on a cron interval
            </p>
            <Button size="sm" onClick={() => setShowForm(true)}>
              Create Schedule
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
