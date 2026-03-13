import fs from 'fs';
import path from 'path';

export interface MemoryEntry {
    name: string;
    summary: string;
    filePath: string; // relative path from memory root
}

export interface MemoryFolder {
    name: string;
    path: string; // relative path from memory root
    entries: MemoryEntry[];
    subfolders: MemoryFolder[];
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Extracts `name` and `summary` fields from the --- delimited frontmatter block.
 */
function parseFrontmatter(content: string): { name: string; summary: string } | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return null;

    const frontmatter = match[1];
    let name = '';
    let summary = '';

    for (const line of frontmatter.split('\n')) {
        const nameMatch = line.match(/^name:\s*["']?(.+?)["']?\s*$/);
        if (nameMatch) {
            name = nameMatch[1];
            continue;
        }
        const summaryMatch = line.match(/^summary:\s*["']?(.+?)["']?\s*$/);
        if (summaryMatch) {
            summary = summaryMatch[1];
        }
    }

    if (!name || !summary) return null;
    return { name, summary };
}

/**
 * Recursively scan a memory directory and build the hierarchy.
 * Only reads frontmatter (name + summary), not the full content.
 */
function scanMemoryDir(dirPath: string, relativePath: string): MemoryFolder {
    const folder: MemoryFolder = {
        name: path.basename(dirPath),
        path: relativePath,
        entries: [],
        subfolders: [],
    };

    if (!fs.existsSync(dirPath)) return folder;

    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
        if (item.name.startsWith('.')) continue; // skip hidden files

        const itemPath = path.join(dirPath, item.name);
        const itemRelative = relativePath ? `${relativePath}/${item.name}` : item.name;

        if (item.isDirectory()) {
            const subfolder = scanMemoryDir(itemPath, itemRelative);
            // Only include folders that have content (entries or non-empty subfolders)
            if (subfolder.entries.length > 0 || subfolder.subfolders.length > 0) {
                folder.subfolders.push(subfolder);
            }
        } else if (item.name.endsWith('.md')) {
            try {
                const content = fs.readFileSync(itemPath, 'utf8');
                const fm = parseFrontmatter(content);
                if (fm) {
                    folder.entries.push({
                        name: fm.name,
                        summary: fm.summary,
                        filePath: itemRelative,
                    });
                }
            } catch {
                // Skip files that can't be read
            }
        }
    }

    return folder;
}

/**
 * Format a memory folder hierarchy as a readable markdown tree.
 */
function formatMemoryTree(folder: MemoryFolder, indent: number = 0): string {
    const lines: string[] = [];
    const prefix = '  '.repeat(indent);

    // Add entries at this level
    for (const entry of folder.entries) {
        lines.push(`${prefix}- **${entry.name}** — ${entry.summary}  \`${entry.filePath}\``);
    }

    // Add subfolders
    for (const sub of folder.subfolders) {
        lines.push(`${prefix}- **[${sub.name}/]**`);
        const subContent = formatMemoryTree(sub, indent + 1);
        if (subContent) {
            lines.push(subContent);
        }
    }

    return lines.join('\n');
}

/**
 * Load the memory index for an agent directory.
 * Returns a formatted markdown string with the hierarchical memory index,
 * or empty string if no memories exist.
 */
export function loadMemoryIndex(agentDir: string): string {
    const memoryDir = path.join(agentDir, 'memory');
    if (!fs.existsSync(memoryDir)) return '';

    const root = scanMemoryDir(memoryDir, '');
    if (root.entries.length === 0 && root.subfolders.length === 0) return '';

    const tree = formatMemoryTree(root);
    return tree;
}
