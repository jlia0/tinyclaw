---
name: memory
description: "Manage your persistent hierarchical memory — save, update, search, and organize knowledge as markdown files in the memory/ folder. Use when: you learn something worth remembering, the user asks you to remember something, you want to recall past knowledge, you need to reorganize or update existing memories, or you want to search through your memories. Triggers: 'remember this', 'save to memory', 'what do you remember about', 'update memory', 'search memory', 'forget', or when you decide something is worth persisting."
---

# Memory

Manage your persistent hierarchical memory system. Memories are stored as markdown files in the `memory/` folder in your workspace, organized into a folder hierarchy that acts as categories/groups.

## Memory Structure

```
memory/
├── project-setup.md              ← root-level memory
├── preferences/                  ← category folder
│   ├── coding-style.md
│   └── communication.md
├── projects/                     ← category folder
│   ├── overview.md
│   └── webapp/                   ← nested category
│       ├── architecture.md
│       └── api-endpoints.md
└── people/
    └── team-contacts.md
```

## Memory File Format

Every memory file MUST have YAML frontmatter with `name` and `summary` fields:

```markdown
---
name: coding-style
summary: User prefers functional style, TypeScript strict mode, no semicolons
---

Detailed notes about the user's coding preferences:

- Functional programming style over OOP
- TypeScript with strict mode enabled
- No semicolons (relies on ASI)
- Prefer const over let
- Use arrow functions for callbacks
```

- **name**: Same as the filename (without .md extension). Acts as the memory identifier.
- **summary**: A short one-line summary of what this memory contains. This is what appears in the memory index — make it informative enough to decide whether to read the full file.
- **Body**: The detailed memory content after the frontmatter. Can be as long as needed.

## Saving a Memory

1. Decide which category folder it belongs in (or root `memory/` if it's top-level)
2. Create the category folder if it doesn't exist: `mkdir -p memory/<category>`
3. Write the `.md` file with proper frontmatter

```bash
cat > memory/preferences/coding-style.md << 'EOF'
---
name: coding-style
summary: User prefers functional TypeScript, strict mode, no semicolons
---

Detailed preferences documented here...
EOF
```

## Updating a Memory

Read the existing file, modify its content, and write it back. Update the `summary` in frontmatter if the core meaning changed.

## Searching Memories

Search through memory content using grep:

```bash
# Search all memories for a keyword
grep -r "keyword" memory/ --include="*.md"

# Search only summaries (frontmatter)
grep -r "summary:" memory/ --include="*.md"

# Find memories in a specific category
ls memory/projects/
```

## Reading a Memory in Detail

The memory index in AGENTS.md only shows name + summary. To read the full content:

```bash
cat memory/<path-to-file>.md
```

## Reorganizing Memory

You can move, rename, or restructure the hierarchy at any time:

```bash
# Create a new category
mkdir -p memory/new-category

# Move a memory to a different category
mv memory/old-location/file.md memory/new-category/file.md

# Rename a memory (update the name field in frontmatter too)
mv memory/old-name.md memory/new-name.md
```

When reorganizing, ensure the `name` field in frontmatter matches the new filename.

## Deleting a Memory

```bash
rm memory/path/to/memory.md
# Remove empty category folders
rmdir memory/empty-category/
```

## Guidelines

- **Save proactively**: When you learn user preferences, project details, important decisions, or anything that would be useful across conversations — save it.
- **Keep summaries concise**: The summary appears in the index that's loaded every conversation. Make it count.
- **Use hierarchy wisely**: Group related memories into folders. Don't create too many levels of nesting (2-3 levels max).
- **Update over create**: If a memory already exists on the topic, update it rather than creating a duplicate.
- **Merge when appropriate**: If you notice related memories scattered around, consolidate them.
- **Prune stale memories**: Remove or update memories that are no longer accurate.
