import fs from 'fs';
import path from 'path';
import { Cron } from 'croner';
import { Schedule, MessageJobData } from './types';
import { TINYAGI_HOME } from './config';
import { log } from './logging';
import { enqueueMessage, insertAgentMessage } from './queues';

export const SCHEDULES_FILE = path.join(TINYAGI_HOME, 'schedules.json');

// Live cron job instances keyed by schedule id
const jobs = new Map<string, Cron>();

// ── Persistence ──────────────────────────────────────────────────────────────

export function getSchedules(): Schedule[] {
    try {
        return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
    } catch {
        return [];
    }
}

export function saveSchedules(schedules: Schedule[]): void {
    fs.mkdirSync(path.dirname(SCHEDULES_FILE), { recursive: true });
    const tmp = SCHEDULES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(schedules, null, 2) + '\n');
    fs.renameSync(tmp, SCHEDULES_FILE);
}

// ── Cron job management ──────────────────────────────────────────────────────

function fireSchedule(schedule: Schedule): void {
    const ts = Date.now();
    const msgId = `${schedule.label}_${ts}_${Math.random().toString(36).slice(2, 6)}`;

    const data: MessageJobData = {
        channel: schedule.channel,
        sender: schedule.sender,
        senderId: `tinyagi-schedule:${schedule.label}`,
        message: `@${schedule.agentId} ${schedule.message}`,
        messageId: msgId,
        agent: schedule.agentId,
    };

    try {
        const rowId = enqueueMessage(data);
        if (rowId) {
            // Persist user-side message so it appears in agent_messages (same as API route)
            insertAgentMessage({
                agentId: schedule.agentId,
                role: 'user',
                channel: schedule.channel,
                sender: schedule.sender,
                messageId: msgId,
                content: data.message,
            });
            log('INFO', `[Schedule] Fired '${schedule.label}' → @${schedule.agentId} (msg ${rowId})`);
        } else {
            log('WARN', `[Schedule] Duplicate messageId for '${schedule.label}', skipped`);
        }
    } catch (err) {
        log('ERROR', `[Schedule] Failed to fire '${schedule.label}': ${(err as Error).message}`);
    }
}

function startJob(schedule: Schedule): void {
    stopJob(schedule.id);
    if (!schedule.enabled) return;

    try {
        if (schedule.runAt) {
            // One-time schedule: fire at the specified date, then auto-disable
            const runDate = new Date(schedule.runAt);
            if (runDate.getTime() <= Date.now()) {
                log('WARN', `[Schedule] One-time '${schedule.label}' is in the past, skipping`);
                return;
            }
            const job = new Cron(runDate, () => {
                fireSchedule(schedule);
                // Auto-disable after firing
                const all = getSchedules();
                const idx = all.findIndex(s => s.id === schedule.id);
                if (idx !== -1) {
                    all[idx].enabled = false;
                    saveSchedules(all);
                }
                jobs.delete(schedule.id);
                log('INFO', `[Schedule] One-time '${schedule.label}' completed, disabled`);
            });
            jobs.set(schedule.id, job);
            log('INFO', `[Schedule] Scheduled one-time '${schedule.label}' at ${schedule.runAt}`);
        } else {
            const job = new Cron(schedule.cron, () => fireSchedule(schedule));
            jobs.set(schedule.id, job);
            log('INFO', `[Schedule] Started cron job '${schedule.label}' (${schedule.cron})`);
        }
    } catch (err) {
        log('ERROR', `[Schedule] Invalid schedule '${schedule.label}': ${(err as Error).message}`);
    }
}

function stopJob(id: string): void {
    const job = jobs.get(id);
    if (job) {
        job.stop();
        jobs.delete(id);
    }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function startScheduler(): void {
    const schedules = getSchedules();
    log('INFO', `[Schedule] Starting scheduler with ${schedules.length} schedule(s)`);
    for (const s of schedules) {
        if (s.enabled) startJob(s);
    }
}

export function stopScheduler(): void {
    for (const [, job] of jobs) {
        job.stop();
    }
    jobs.clear();
    log('INFO', '[Schedule] Scheduler stopped');
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function addSchedule(opts: {
    cron?: string;
    runAt?: string;
    agentId: string;
    message: string;
    label?: string;
    channel?: string;
    sender?: string;
    enabled?: boolean;
}): Schedule {
    if (!opts.cron && !opts.runAt) {
        throw new Error('Either cron or runAt is required');
    }

    if (opts.runAt) {
        const d = new Date(opts.runAt);
        if (isNaN(d.getTime())) throw new Error('Invalid runAt date');
        if (d.getTime() <= Date.now()) throw new Error('runAt must be in the future');
    }

    if (opts.cron) {
        // Validate by attempting to construct a Cron (throws on invalid expression)
        try {
            const testJob = new Cron(opts.cron.trim());
            testJob.stop();
        } catch (err) {
            throw new Error(`Invalid cron expression: ${(err as Error).message}`);
        }
    }

    const schedules = getSchedules();
    const label = opts.label || `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (schedules.some(s => s.label === label)) {
        throw new Error(`A schedule with label '${label}' already exists`);
    }

    const schedule: Schedule = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        cron: opts.cron?.trim() || '',
        agentId: opts.agentId,
        message: opts.message,
        channel: opts.channel || 'schedule',
        sender: opts.sender || 'Scheduler',
        enabled: opts.enabled !== false,
        createdAt: Date.now(),
        ...(opts.runAt ? { runAt: opts.runAt } : {}),
    };

    schedules.push(schedule);
    saveSchedules(schedules);
    startJob(schedule);
    log('INFO', `[Schedule] Created schedule '${label}' for @${opts.agentId}`);
    return schedule;
}

export function removeSchedule(id: string): boolean {
    const schedules = getSchedules();
    const idx = schedules.findIndex(s => s.id === id || s.label === id);
    if (idx === -1) return false;

    const removed = schedules.splice(idx, 1)[0];
    saveSchedules(schedules);
    stopJob(removed.id);
    log('INFO', `[Schedule] Deleted schedule '${removed.label}'`);
    return true;
}

export function updateSchedule(id: string, updates: Partial<Omit<Schedule, 'id' | 'createdAt'>>): Schedule | null {
    const schedules = getSchedules();
    const idx = schedules.findIndex(s => s.id === id);
    if (idx === -1) return null;

    if (updates.cron) {
        try {
            const testJob = new Cron(updates.cron.trim());
            testJob.stop();
        } catch (err) {
            throw new Error(`Invalid cron expression: ${(err as Error).message}`);
        }
    }

    if (updates.label && updates.label !== schedules[idx].label) {
        if (schedules.some(s => s.label === updates.label && s.id !== id)) {
            throw new Error(`A schedule with label '${updates.label}' already exists`);
        }
    }

    Object.assign(schedules[idx], updates);
    saveSchedules(schedules);
    startJob(schedules[idx]); // restart with updated config
    log('INFO', `[Schedule] Updated schedule '${schedules[idx].label}'`);
    return schedules[idx];
}
