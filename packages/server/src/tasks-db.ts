/**
 * SQLite-backed persistence for tasks, projects, and comments.
 * Separate DB from the queue system (tasks.db vs tinyagi.db).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { TINYAGI_HOME } from '@tinyagi/core';
import { log } from '@tinyagi/core';

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
export type ProjectStatus = 'active' | 'archived';

export const PROJECT_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#ef4444',
    '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
    '#3b82f6', '#a855f7',
] as const;

export interface Project {
    id: string;
    name: string;
    description: string;
    prefix: string;
    color: string;
    status: ProjectStatus;
    createdAt: number;
    updatedAt: number;
}

export interface Task {
    id: string;
    number: number;
    title: string;
    description: string;
    status: TaskStatus;
    assignee: string;
    assigneeType: 'agent' | 'team' | '';
    projectId?: string;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
    identifier?: string; // computed: e.g. "SYS-1" or "T-5"
}

export interface Comment {
    id: string;
    taskId: string;
    author: string;
    authorType: 'user' | 'agent';
    content: string;
    createdAt: number;
}

// ── DB singleton ─────────────────────────────────────────────────────────────

const TASKS_DB_PATH = path.join(TINYAGI_HOME, 'tasks.db');
let db: Database.Database | null = null;

function getDb(): Database.Database {
    if (!db) throw new Error('Tasks DB not initialized — call initTasksDb() first');
    return db;
}

function genId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Row mappers ──────────────────────────────────────────────────────────────

function rowToProject(r: any): Project {
    return {
        id: r.id,
        name: r.name,
        description: r.description,
        prefix: r.prefix || '',
        color: r.color || PROJECT_COLORS[0],
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function rowToTask(r: any, projectPrefix?: string): Task {
    const num = r.number ?? 0;
    const prefix = projectPrefix ?? r._project_prefix ?? '';
    return {
        id: r.id,
        number: num,
        title: r.title,
        description: r.description,
        status: r.status,
        assignee: r.assignee,
        assigneeType: r.assignee_type,
        projectId: r.project_id || undefined,
        sortOrder: r.sort_order,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        identifier: prefix ? `${prefix}-${num}` : `T-${num}`,
    };
}

/** Generate a short prefix from a project name (e.g. "sys design" -> "SYS") */
function generatePrefix(name: string): string {
    const words = name.trim().split(/\s+/);
    if (words.length === 1) {
        return words[0].slice(0, 3).toUpperCase();
    }
    return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
}

function pickColor(index: number): string {
    return PROJECT_COLORS[index % PROJECT_COLORS.length];
}

function rowToComment(r: any): Comment {
    return {
        id: r.id,
        taskId: r.task_id,
        author: r.author,
        authorType: r.author_type,
        content: r.content,
        createdAt: r.created_at,
    };
}

// ── Init & migration ─────────────────────────────────────────────────────────

export function initTasksDb(): void {
    if (db) return;
    db = new Database(TASKS_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            prefix TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL DEFAULT '#6366f1',
            status TEXT NOT NULL DEFAULT 'active',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            number INTEGER NOT NULL DEFAULT 0,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'backlog',
            assignee TEXT NOT NULL DEFAULT '',
            assignee_type TEXT NOT NULL DEFAULT '',
            project_id TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            author TEXT NOT NULL,
            author_type TEXT NOT NULL DEFAULT 'user',
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, status);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, sort_order);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
        CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);
    `);

    // Migrate JSON data first, then backfill schema additions (prefix, color, number)
    migrateJsonData();
    migrateSchema();
    log('INFO', '[TasksDB] Initialized');
}

function migrateSchema(): void {
    const d = getDb();
    // Add prefix/color to projects if missing
    const projCols = d.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    const projColNames = new Set(projCols.map(c => c.name));
    if (!projColNames.has('prefix')) {
        d.exec("ALTER TABLE projects ADD COLUMN prefix TEXT NOT NULL DEFAULT ''");
    }
    if (!projColNames.has('color')) {
        d.exec("ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT '#6366f1'");
    }
    // Add number to tasks if missing
    const taskCols = d.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    const taskColNames = new Set(taskCols.map(c => c.name));
    if (!taskColNames.has('number')) {
        d.exec("ALTER TABLE tasks ADD COLUMN number INTEGER NOT NULL DEFAULT 0");
    }
    // Backfill: assign prefixes and varied colors to projects that don't have them
    const unprefixed = d.prepare("SELECT id, name FROM projects WHERE prefix = ''").all() as { id: string; name: string }[];
    for (let i = 0; i < unprefixed.length; i++) {
        const p = unprefixed[i];
        const prefix = generatePrefix(p.name);
        const color = pickColor(i);
        d.prepare("UPDATE projects SET prefix = ?, color = ? WHERE id = ?").run(prefix, color, p.id);
    }
    // Also backfill projects that all have the same default color
    const allSameColor = d.prepare("SELECT id FROM projects WHERE color = '#6366f1'").all() as { id: string }[];
    if (allSameColor.length > 1) {
        for (let i = 0; i < allSameColor.length; i++) {
            d.prepare("UPDATE projects SET color = ? WHERE id = ?").run(pickColor(i), allSameColor[i].id);
        }
    }
    // Backfill: assign numbers to tasks that have number=0
    const unnumbered = d.prepare("SELECT id, project_id FROM tasks WHERE number = 0 ORDER BY created_at ASC").all() as { id: string; project_id: string | null }[];
    if (unnumbered.length > 0) {
        const counters: Record<string, number> = {};
        for (const t of unnumbered) {
            const key = t.project_id || '__global';
            counters[key] = (counters[key] || 0) + 1;
            d.prepare("UPDATE tasks SET number = ? WHERE id = ?").run(counters[key], t.id);
        }
    }
}

function migrateJsonData(): void {
    const d = getDb();

    // Migrate projects
    const projectsFile = path.join(TINYAGI_HOME, 'projects.json');
    if (fs.existsSync(projectsFile)) {
        const count = (d.prepare('SELECT COUNT(*) as cnt FROM projects').get() as { cnt: number }).cnt;
        if (count === 0) {
            try {
                const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
                const stmt = d.prepare(
                    `INSERT INTO projects (id, name, description, prefix, color, status, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                );
                for (let i = 0; i < projects.length; i++) {
                    const p = projects[i];
                    stmt.run(p.id, p.name, p.description || '', generatePrefix(p.name), pickColor(i), p.status || 'active', p.createdAt, p.updatedAt);
                }
                fs.renameSync(projectsFile, projectsFile + '.migrated');
                log('INFO', `[TasksDB] Migrated ${projects.length} projects from JSON`);
            } catch (err) {
                log('ERROR', `[TasksDB] Failed to migrate projects: ${err}`);
            }
        }
    }

    // Migrate tasks
    const tasksFile = path.join(TINYAGI_HOME, 'tasks.json');
    if (fs.existsSync(tasksFile)) {
        const count = (d.prepare('SELECT COUNT(*) as cnt FROM tasks').get() as { cnt: number }).cnt;
        if (count === 0) {
            try {
                const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
                const stmt = d.prepare(
                    `INSERT INTO tasks (id, title, description, status, assignee, assignee_type, project_id, sort_order, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                );
                for (let i = 0; i < tasks.length; i++) {
                    const t = tasks[i];
                    stmt.run(t.id, t.title, t.description || '', t.status || 'backlog',
                        t.assignee || '', t.assigneeType || '', t.projectId || null, i,
                        t.createdAt, t.updatedAt);
                }
                fs.renameSync(tasksFile, tasksFile + '.migrated');
                log('INFO', `[TasksDB] Migrated ${tasks.length} tasks from JSON`);
            } catch (err) {
                log('ERROR', `[TasksDB] Failed to migrate tasks: ${err}`);
            }
        }
    }
}

// ── Projects ─────────────────────────────────────────────────────────────────

export function getProjects(status?: string): Project[] {
    const d = getDb();
    if (status) {
        return (d.prepare('SELECT * FROM projects WHERE status=? ORDER BY created_at DESC').all(status) as any[]).map(rowToProject);
    }
    return (d.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as any[]).map(rowToProject);
}

export function getProject(id: string): Project | undefined {
    const row = getDb().prepare('SELECT * FROM projects WHERE id=?').get(id) as any;
    return row ? rowToProject(row) : undefined;
}

export function createProject(data: { name: string; description?: string; prefix?: string; color?: string; status?: ProjectStatus }): Project {
    const now = Date.now();
    const d = getDb();
    const projectCount = (d.prepare('SELECT COUNT(*) as cnt FROM projects').get() as { cnt: number }).cnt;
    const project: Project = {
        id: genId('proj'),
        name: data.name,
        description: data.description || '',
        prefix: data.prefix || generatePrefix(data.name),
        color: data.color || pickColor(projectCount),
        status: data.status || 'active',
        createdAt: now,
        updatedAt: now,
    };
    d.prepare(
        `INSERT INTO projects (id, name, description, prefix, color, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(project.id, project.name, project.description, project.prefix, project.color, project.status, project.createdAt, project.updatedAt);
    return project;
}

export function updateProject(id: string, data: Partial<Omit<Project, 'id' | 'createdAt'>>): Project | undefined {
    const d = getDb();
    const existing = d.prepare('SELECT * FROM projects WHERE id=?').get(id) as any;
    if (!existing) return undefined;
    const updated = {
        name: data.name ?? existing.name,
        description: data.description ?? existing.description,
        prefix: data.prefix ?? existing.prefix,
        color: data.color ?? existing.color,
        status: data.status ?? existing.status,
        updated_at: Date.now(),
    };
    d.prepare('UPDATE projects SET name=?, description=?, prefix=?, color=?, status=?, updated_at=? WHERE id=?')
        .run(updated.name, updated.description, updated.prefix, updated.color, updated.status, updated.updated_at, id);
    return rowToProject({ ...existing, ...updated });
}

export function deleteProject(id: string): boolean {
    return getDb().prepare('DELETE FROM projects WHERE id=?').run(id).changes > 0;
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export function getTasks(filters?: { projectId?: string; status?: TaskStatus; assignee?: string }): Task[] {
    const d = getDb();
    let sql = 'SELECT t.*, p.prefix as _project_prefix FROM tasks t LEFT JOIN projects p ON t.project_id = p.id';
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.projectId) {
        conditions.push('t.project_id=?');
        params.push(filters.projectId);
    }
    if (filters?.status) {
        conditions.push('t.status=?');
        params.push(filters.status);
    }
    if (filters?.assignee) {
        conditions.push('t.assignee=?');
        params.push(filters.assignee);
    }
    if (conditions.length) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY t.sort_order ASC, t.created_at ASC';
    return (d.prepare(sql).all(...params) as any[]).map(r => rowToTask(r));
}

export function getTask(id: string): Task | undefined {
    const d = getDb();
    const row = d.prepare('SELECT t.*, p.prefix as _project_prefix FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id=?').get(id) as any;
    return row ? rowToTask(row) : undefined;
}

export function createTask(data: {
    title: string;
    description?: string;
    status?: TaskStatus;
    assignee?: string;
    assigneeType?: 'agent' | 'team' | '';
    projectId?: string;
}): Task {
    const now = Date.now();
    const d = getDb();

    // Get max sort_order for the target status
    const maxOrder = (d.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) as m FROM tasks WHERE status=?'
    ).get(data.status || 'backlog') as { m: number }).m;

    // Get next sequential number (scoped to project, or global for unassigned)
    const nextNum = data.projectId
        ? (d.prepare('SELECT COALESCE(MAX(number), 0) + 1 as n FROM tasks WHERE project_id=?').get(data.projectId) as { n: number }).n
        : (d.prepare('SELECT COALESCE(MAX(number), 0) + 1 as n FROM tasks WHERE project_id IS NULL').get() as { n: number }).n;

    // Look up project prefix for identifier
    let prefix = '';
    if (data.projectId) {
        const proj = d.prepare('SELECT prefix FROM projects WHERE id=?').get(data.projectId) as { prefix: string } | undefined;
        prefix = proj?.prefix || '';
    }

    const task: Task = {
        id: genId('task'),
        number: nextNum,
        title: data.title,
        description: data.description || '',
        status: data.status || 'backlog',
        assignee: data.assignee || '',
        assigneeType: data.assigneeType || '',
        projectId: data.projectId || undefined,
        sortOrder: maxOrder + 1,
        createdAt: now,
        updatedAt: now,
        identifier: prefix ? `${prefix}-${nextNum}` : `T-${nextNum}`,
    };
    d.prepare(
        `INSERT INTO tasks (id, number, title, description, status, assignee, assignee_type, project_id, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(task.id, task.number, task.title, task.description, task.status, task.assignee, task.assigneeType,
        task.projectId || null, task.sortOrder, task.createdAt, task.updatedAt);
    return task;
}

export function updateTask(id: string, data: Partial<Omit<Task, 'id' | 'createdAt'>>): Task | undefined {
    const d = getDb();
    const existing = d.prepare('SELECT * FROM tasks WHERE id=?').get(id) as any;
    if (!existing) return undefined;
    const updated = {
        title: data.title ?? existing.title,
        description: data.description ?? existing.description,
        status: data.status ?? existing.status,
        assignee: data.assignee ?? existing.assignee,
        assignee_type: data.assigneeType ?? existing.assignee_type,
        project_id: data.projectId !== undefined ? (data.projectId || null) : existing.project_id,
        sort_order: data.sortOrder ?? existing.sort_order,
        updated_at: Date.now(),
    };
    d.prepare(
        `UPDATE tasks SET title=?, description=?, status=?, assignee=?, assignee_type=?, project_id=?, sort_order=?, updated_at=? WHERE id=?`
    ).run(updated.title, updated.description, updated.status, updated.assignee,
        updated.assignee_type, updated.project_id, updated.sort_order, updated.updated_at, id);
    // Re-fetch with JOIN to get correct identifier
    return getTask(id);
}

export function deleteTask(id: string): boolean {
    return getDb().prepare('DELETE FROM tasks WHERE id=?').run(id).changes > 0;
}

export function reorderTasks(columns: Record<string, string[]>): void {
    const d = getDb();
    d.transaction(() => {
        const now = Date.now();
        for (const [status, taskIds] of Object.entries(columns)) {
            for (let i = 0; i < taskIds.length; i++) {
                d.prepare('UPDATE tasks SET status=?, sort_order=?, updated_at=? WHERE id=?')
                    .run(status, i, now, taskIds[i]);
            }
        }
    })();
}

// ── Comments ─────────────────────────────────────────────────────────────────

export function getComments(taskId: string): Comment[] {
    return (getDb().prepare(
        'SELECT * FROM comments WHERE task_id=? ORDER BY created_at ASC'
    ).all(taskId) as any[]).map(rowToComment);
}

export function createComment(data: {
    taskId: string;
    author: string;
    authorType: 'user' | 'agent';
    content: string;
}): Comment {
    const now = Date.now();
    const comment: Comment = {
        id: genId('cmt'),
        taskId: data.taskId,
        author: data.author,
        authorType: data.authorType,
        content: data.content,
        createdAt: now,
    };
    getDb().prepare(
        `INSERT INTO comments (id, task_id, author, author_type, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(comment.id, comment.taskId, comment.author, comment.authorType, comment.content, comment.createdAt);
    return comment;
}

export function deleteComment(id: string): boolean {
    return getDb().prepare('DELETE FROM comments WHERE id=?').run(id).changes > 0;
}

export function getCommentCount(taskId: string): number {
    return (getDb().prepare('SELECT COUNT(*) as cnt FROM comments WHERE task_id=?').get(taskId) as { cnt: number }).cnt;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function closeTasksDb(): void {
    if (db) { db.close(); db = null; }
}
