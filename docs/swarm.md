# Agent Swarm

Swarms are TinyClaw's orchestration primitive for large-scale parallel work. While **agents** handle single conversations and **teams** enable collaborative multi-agent workflows, **swarms** process thousands of similar items concurrently using a map-reduce pipeline.

**Use cases:**
- Review 3,000 pull requests across a GitHub organization
- Find duplicate/conflicting PRs in a large repo
- Analyze 10,000 log entries for anomalies
- Summarize hundreds of documents into a literature review
- Audit thousands of configuration files for compliance
- Classify 5,000 support tickets by category

## Table of Contents

- [Architecture](#architecture)
  - [Standard Pipeline](#standard-pipeline)
  - [Shuffle Pipeline](#shuffle-pipeline)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
  - [Phase 1: Input Resolution](#phase-1-input-resolution)
  - [Phase 2: Batch Splitting](#phase-2-batch-splitting)
  - [Phase 3: Map (Worker Pool)](#phase-3-map-worker-pool)
  - [Phase 4a: Shuffle (Optional)](#phase-4a-shuffle-optional)
  - [Phase 4b: Reduce](#phase-4b-reduce)
  - [Phase 5: Output](#phase-5-output)
- [Configuration Reference](#configuration-reference)
- [Input Sources](#input-sources)
- [Prompt Templates](#prompt-templates)
- [Reduce Strategies](#reduce-strategies)
- [Shuffle: Cross-Batch Comparison](#shuffle-cross-batch-comparison)
- [CLI Commands](#cli-commands)
- [Examples](#examples)
- [Queue Integration](#queue-integration)
- [Events & Monitoring](#events--monitoring)
- [Tuning Guide](#tuning-guide)
- [Limits & Defaults](#limits--defaults)
- [Source Files](#source-files)

---

## Architecture

### Standard Pipeline

For tasks where each item is processed independently (review, classify, summarize):

```
User: "@pr-reviewer review PRs in owner/repo"
         │
         ▼
┌─────────────────┐
│ Input Resolution │  Run shell command → 3000 PR objects
└────────┬────────┘
         ▼
┌─────────────────┐
│ Batch Splitter   │  3000 items ÷ 25 = 120 batches
└────────┬────────┘
         ▼
┌─────────────────┐     ┌──────────┐
│  Worker Pool     │────▶│ Worker 1 │──▶ Batch result 1
│                  │────▶│ Worker 2 │──▶ Batch result 2
│  10 concurrent   │────▶│ ...      │──▶ ...
│  workers         │────▶│ Worker N │──▶ Batch result 120
└────────┬────────┘     └──────────┘
         ▼
┌─────────────────┐
│  Reducer         │  Aggregate 120 results → final report
└────────┬────────┘
         ▼
  Response → User
```

**Throughput**: With 10 concurrent workers and ~20s per batch invocation, 120 batches complete in ~4 minutes (not 40 minutes sequentially).

### Shuffle Pipeline

For tasks requiring cross-item comparison (dedup, conflict detection, pattern matching):

```
┌─────────────────┐     ┌──────────┐
│  Worker Pool     │────▶│ Worker 1 │──▶ [{pr:42, tags:["auth"]}, ...]
│  (Map)           │────▶│ Worker 2 │──▶ [{pr:1876, tags:["auth"]}, ...]
│                  │────▶│ Worker N │──▶ [...]
└────────┬────────┘     └──────────┘
         ▼
┌─────────────────┐
│  Shuffle         │  Parse all fingerprints, group by "tags":
│                  │    "auth"     → [PR#42, PR#1876, PR#99, ...]
│                  │    "bugfix"   → [PR#42, PR#55, ...]
│                  │    "refactor" → [PR#200, PR#3001, ...]
└────────┬────────┘
         ▼
┌─────────────────┐     ┌──────────────┐
│  Partition       │────▶│ "auth" group │──▶ "Duplicates: #42 ↔ #1876"
│  Reduce          │────▶│ "bugfix" grp │──▶ "Duplicates: #42 ↔ #55"
│  (parallel)      │────▶│ "refactor"   │──▶ "No duplicates"
└────────┬────────┘     └──────────────┘
         ▼
┌─────────────────┐
│  Final Merge     │  Deduplicate findings across partitions
└────────┬────────┘
         ▼
  Response → User
```

**Why shuffle matters**: Without it, PR#42 (batch 3) and PR#1876 (batch 95) are never compared — they live in different batch results that get summarized independently. With shuffle, both share the tag `"auth"`, so they're grouped into the same partition and the reducer sees them side by side.

---

## Quick Start

### 1. Create a Swarm

**Interactively:**
```bash
tinyclaw swarm add
```

**Or add directly to `settings.json`:**
```json
{
  "swarms": {
    "pr-reviewer": {
      "name": "PR Reviewer",
      "agent": "coder",
      "concurrency": 10,
      "batch_size": 25,
      "input": {
        "command": "gh pr list --repo {{repo}} --limit 5000 --json number,title,url,additions,deletions",
        "type": "json_array"
      },
      "prompt_template": "Review each PR. For each, provide:\n1. Summary\n2. Risk level (low/medium/high)\n3. Recommended action\n\nPRs:\n{{items}}",
      "reduce": {
        "strategy": "hierarchical",
        "prompt": "Compile these reviews into a prioritized report grouped by risk level."
      },
      "progress_interval": 10
    }
  }
}
```

### 2. Trigger the Swarm

**From any messaging channel (Discord, Telegram, WhatsApp):**
```
@pr-reviewer review PRs in owner/repo
```

**From CLI:**
```bash
tinyclaw swarm run pr-reviewer "review PRs in owner/repo"
```

### 3. Watch Progress

The swarm sends real-time updates to your channel:
```
PR Reviewer swarm activated. Preparing to process your request...
PR Reviewer: Processing 3000 items in 120 batches (25 per batch, 10 workers)...
PR Reviewer progress: 30/120 batches (25%)
PR Reviewer progress: 60/120 batches (50%) | ~12m 30s remaining
PR Reviewer progress: 90/120 batches (75%) | ~6m remaining
PR Reviewer: All batches complete. Aggregating results...
PR Reviewer completed in 24m 15s
Items: 3000 | Batches: 120 (118 ok, 2 failed) | Workers: 10
```

---

## How It Works

### Phase 1: Input Resolution

The swarm needs a list of items to process. Items are resolved from the first available source (in priority order):

| Priority | Source | Example |
|----------|--------|---------|
| 1 | **Inline JSON array** in user message | `@swarm review these: [{"pr": 1}, {"pr": 2}]` |
| 2 | **Attached files** sent with the message | Upload a `.json` or `.txt` file via Discord/Telegram |
| 3 | **Shell command** from swarm config | `gh pr list --repo {{repo}} --json number,title` |
| 4 | **Backtick command** in user message | `` @swarm review from `gh pr list --limit 100` `` |
| 5 | **Message lines** as individual items | Multi-line message where each line is an item |

**Template parameter extraction**: The input command supports `{{param}}` placeholders. Values are extracted from the user's message:

```json
{
  "input": {
    "command": "gh pr list --repo {{repo}} --limit {{limit}} --json number,title"
  }
}
```

User sends: `"review PRs in facebook/react limit 500"`

The resolver extracts:
- `{{repo}}` → `facebook/react` (detected from `owner/name` pattern)
- `{{limit}}` → `500` (detected from numeric value)

You can also be explicit: `"repo=facebook/react limit=500"`.

**Implementation**: `src/swarm/batch-splitter.ts` — `resolveInputItems()`, `resolveTemplateParams()`

### Phase 2: Batch Splitting

Items are divided into fixed-size batches:

```
3000 items ÷ batch_size(25) = 120 batches

Batch 0:  items[0..24]
Batch 1:  items[25..49]
Batch 2:  items[50..74]
...
Batch 119: items[2975..2999]
```

The last batch may be smaller if items don't divide evenly.

**Implementation**: `src/swarm/batch-splitter.ts` — `splitIntoBatches()`

### Phase 3: Map (Worker Pool)

Batches are processed in parallel using a semaphore-bounded worker pool:

```
Concurrency = 10

Time 0:   [Batch 0] [Batch 1] [Batch 2] ... [Batch 9]    ← 10 in-flight
Time 20s: [Batch 10] completes, [Batch 10] starts          ← Batch 0 done
Time 22s: [Batch 1] completes, [Batch 11] starts
...
```

**For each batch:**
1. Acquire semaphore slot (wait if at concurrency limit)
2. Render `prompt_template` with batch items injected
3. Invoke the configured agent with a **fresh conversation** (`shouldReset=true`)
4. On failure: retry up to 2 times with exponential backoff (2s, 4s)
5. Record result and release semaphore slot

**Important**: Each batch starts a fresh agent conversation. This prevents cross-contamination between batches — batch 50's context won't leak into batch 51.

**Progress callbacks**: After each batch completes, the swarm processor:
- Updates the progress counter
- Estimates time remaining based on average throughput
- Sends a progress message to the user every `progress_interval` batches

**Implementation**: `src/swarm/worker-pool.ts` — `processAllBatches()`, `Semaphore`

### Phase 4a: Shuffle (Optional)

> Skip this phase if your swarm config doesn't include `shuffle`. Items go directly from map to reduce.

The shuffle phase re-partitions map outputs by a key field. This is required for tasks where items must be compared against each other (dedup, conflict detection, pattern finding).

**Step by step:**

1. **Parse map outputs**: Each batch result is expected to contain structured data (JSON array, JSONL, or JSON embedded in text). The parser tries multiple formats:
   - Entire result is a JSON array → extract items
   - Result contains a JSON array (possibly in a code fence) → extract it
   - Result has line-separated JSON objects (JSONL) → parse each line

2. **Extract partition keys**: For each parsed item, read the `key_field` (e.g., `"tags"`). If the value is an array, the item gets multiple keys.

3. **Group by key**: All items sharing a key go into the same partition.

4. **Handle multi-key items** (`multi_key` setting):
   - `"duplicate"` (default): An item with `tags: ["auth", "bugfix"]` goes into BOTH the `"auth"` and `"bugfix"` partitions. This ensures no pairs are missed.
   - `"first"`: Item goes into only the first key's partition. Faster but may miss cross-key relationships.

5. **Sub-split oversized partitions**: If a popular key (e.g., `"bugfix"`) has 500+ items exceeding `max_partition_size`, it's split into sub-partitions (`"bugfix_part1"`, `"bugfix_part2"`, etc.) to stay within model context limits.

6. **Reduce each partition**: Each partition is sent to the reduce agent with the `shuffle.reduce_prompt`. Partitions are processed in parallel (same concurrency as the map phase).

7. **Final merge**: All partition results are combined and sent to the reduce agent with the `shuffle.merge_prompt` for a final consolidated report.

**Implementation**: `src/swarm/shuffle.ts` — `shuffleByKey()`, `shuffleReducePartitions()`

### Phase 4b: Reduce

Without shuffle, batch results go directly to the reducer. Three strategies are available:

#### Concatenate (default)
Simply joins all batch results with `---` separators and batch headers:
```
## Batch 1 of 120
[result 1]

---

## Batch 2 of 120
[result 2]
```

Best for: Raw output where you want every batch result preserved.

#### Summarize
Feeds ALL batch results (concatenated) to a single agent invocation with the `reduce.prompt`. The agent synthesizes everything into one coherent output.

```
All 120 batch results → single agent call → final summary
```

**Context limit safety**: If combined results exceed ~150K estimated tokens (~600K characters), automatically falls back to hierarchical to avoid exceeding model context limits.

Best for: Medium-scale results that fit in one context window.

#### Hierarchical
Tree reduction for very large outputs. Groups results, summarizes each group, then recursively reduces until reaching a single output:

```
120 batch results
    ↓ group into chunks of 20
6 groups (20 results each)
    ↓ summarize each group in parallel
6 group summaries
    ↓ summarize all 6 together
1 final report
```

For even larger scales (400+ batches):
```
400 batch results → 20 groups → 20 summaries → 1 group → 1 final
```

**Limitation**: Each reduction level loses information. The final merger only sees group summaries, not individual items. This is fine for **aggregation** (counts, averages, overall themes) but breaks **cross-referencing** (dedup, conflict detection). Use [shuffle](#shuffle-cross-batch-comparison) for cross-referencing tasks.

Best for: Very large-scale aggregation where some information loss is acceptable.

**Implementation**: `src/swarm/reducer.ts` — `reduceBatchResults()`, `reduceSummarize()`, `reduceHierarchical()`

### Phase 5: Output

The final result is sent back to the user's channel with a stats header:

```
PR Reviewer completed in 24m 15s
Items: 3000 | Batches: 120 (118 ok, 2 failed) | Workers: 10

---

[aggregated results]
```

If the response exceeds 4000 characters, the full text is saved as a `.md` file in `~/.tinyclaw/files/` and attached to the message. The channel receives a truncated preview with the file attached.

**Implementation**: `src/swarm/swarm-processor.ts` — `sendFinalResponse()`

---

## Configuration Reference

### SwarmConfig

Add to `settings.json` under the `"swarms"` key:

```json
{
  "swarms": {
    "<swarm_id>": {
      "name": "...",
      "agent": "...",
      ...
    }
  }
}
```

**Swarm IDs share the same namespace as agent and team IDs** — you cannot have a swarm and an agent with the same ID.

#### Core Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Display name shown in progress messages |
| `description` | string | no | — | Human-readable description (for documentation) |
| `agent` | string | yes | — | Agent ID from the `agents` config to use as worker. Must exist. |
| `concurrency` | number | no | `5` | Max parallel workers. Higher = faster but more resource-intensive. |
| `batch_size` | number | no | `25` | Items per batch. Larger = fewer batches but more tokens per invocation. |
| `prompt_template` | string | yes | — | Template sent to each worker. See [Prompt Templates](#prompt-templates). |
| `progress_interval` | number | no | `10` | Send progress updates every N batches. `0` = no updates. |

#### Input Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `input` | object | — | How to obtain input items. Optional if items come from user message. |
| `input.command` | string | — | Shell command to run. Supports `{{param}}` placeholders. |
| `input.type` | string | `"lines"` | How to parse command output: `"lines"` (one per line) or `"json_array"`. |

#### Reduce Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `reduce` | object | — | How to aggregate batch results |
| `reduce.strategy` | string | `"concatenate"` | `"concatenate"`, `"summarize"`, or `"hierarchical"` |
| `reduce.prompt` | string | — | Custom prompt for the reduce agent. Overrides the default summarization instruction. |
| `reduce.agent` | string | (swarm agent) | Agent ID for reduction. Use a different agent (e.g., a "writer" agent) for higher-quality summaries. |

#### Shuffle Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `shuffle` | object | — | Enable shuffle phase for cross-referencing tasks. Omit entirely for standard pipeline. |
| `shuffle.key_field` | string | (required) | JSON field name to partition by (e.g., `"tags"`, `"key_files"`, `"category"`) |
| `shuffle.multi_key` | string | `"duplicate"` | For array-valued keys: `"duplicate"` = item in ALL key partitions, `"first"` = only first key |
| `shuffle.max_partition_size` | number | `200` | Max items per partition before sub-splitting |
| `shuffle.reduce_prompt` | string | — | Prompt for each partition. Supports `{{partition_key}}`, `{{items}}`, `{{item_count}}`, `{{user_message}}` |
| `shuffle.merge_prompt` | string | — | Prompt for the final merge of all partition results |

---

## Input Sources

### 1. Inline JSON Array

Include a JSON array directly in your message:

```
@my-swarm process these: [
  {"id": 1, "title": "Fix auth"},
  {"id": 2, "title": "Add tests"},
  {"id": 3, "title": "Refactor API"}
]
```

### 2. Attached File

Send a file (via Discord/Telegram upload) alongside the message. The file can contain:
- **JSON array**: `[{"item": 1}, {"item": 2}, ...]`
- **Lines**: One item per line

The `input.type` config determines how the file is parsed.

### 3. Shell Command (from config)

Configure the `input.command` in settings. It runs automatically when the swarm is triggered:

```json
{
  "input": {
    "command": "gh pr list --repo {{repo}} --state open --limit 5000 --json number,title,url,additions,deletions,changedFiles",
    "type": "json_array"
  }
}
```

The `{{repo}}` placeholder is extracted from the user's message. Supported auto-extraction:

| Placeholder | Auto-detects | Example message |
|------------|--------------|-----------------|
| `{{repo}}` | `owner/name` pattern | "review PRs in **facebook/react**" |
| `{{limit}}` | 2+ digit numbers | "review **500** PRs" |
| `key=value` | Explicit assignments | "**repo=facebook/react** limit=500" |

If a placeholder can't be resolved, it remains as-is in the command (which will likely cause it to fail — so make sure your message contains the needed values).

### 4. Backtick Command

Override or provide an ad-hoc command inline using backticks:

```
@my-swarm analyze output from `kubectl get pods -A -o json | jq '.items'`
```

This takes priority over the config's `input.command`.

### 5. Message Lines (Fallback)

If no other input source matches and the message has multiple lines, each line becomes an item:

```
@my-swarm process these URLs:
https://example.com/page1
https://example.com/page2
https://example.com/page3
```

---

## Prompt Templates

The `prompt_template` is the instruction sent to each worker for each batch. Use placeholders to inject batch-specific data:

| Placeholder | Description | Example value |
|------------|-------------|---------------|
| `{{items}}` | Batch items, one per line | `{"pr": 1, "title": "Fix auth"}\n{"pr": 2, "title": "Add tests"}` |
| `{{items_json}}` | Batch items as a formatted JSON array | `[\n  {"pr": 1, ...},\n  {"pr": 2, ...}\n]` |
| `{{batch_number}}` | 1-based batch number | `7` |
| `{{batch_index}}` | 0-based batch index | `6` |
| `{{total_batches}}` | Total number of batches | `120` |
| `{{batch_size}}` | Number of items in this specific batch | `25` |
| `{{user_message}}` | The user's original trigger message | `"review PRs in facebook/react"` |

**Tips for writing good prompt templates:**

1. **Be specific about output format** — if you need structured data for shuffle, ask for JSON arrays explicitly:
   ```
   Output ONLY a JSON array. No other text.
   ```

2. **Include batch context** — helps the agent understand the scope:
   ```
   PRs (batch {{batch_number}} of {{total_batches}}):
   ```

3. **Keep the item format simple** — use `{{items}}` for line-separated or `{{items_json}}` for JSON. Don't mix them.

4. **For shuffle, enforce strict output** — the shuffle parser needs to read structured data from the map output. Ask workers to output clean JSON.

---

## Reduce Strategies

### When to Use Which

| Strategy | Best for | Handles cross-batch? | Information loss |
|----------|----------|---------------------|-----------------|
| `concatenate` | Raw results, debugging, small scale | N/A (no reduction) | None |
| `summarize` | Medium scale (< 150K tokens combined) | No | Moderate |
| `hierarchical` | Large scale (150K+ tokens) aggregation | No | Progressive |
| shuffle | Any scale requiring cross-item comparison | **Yes** | Minimal |

### Concatenate

```json
{ "reduce": { "strategy": "concatenate" } }
```

Output:
```
## Batch 1 of 120
[batch 1 result]

---

## Batch 2 of 120
[batch 2 result]
```

### Summarize

```json
{
  "reduce": {
    "strategy": "summarize",
    "prompt": "Create an executive summary with key findings and recommendations."
  }
}
```

The prompt is prepended with context about the batch count and original task, then all concatenated batch results are appended. One agent invocation produces the final output.

**Auto-fallback**: If combined results exceed ~600K characters (~150K tokens), automatically switches to hierarchical.

### Hierarchical

```json
{
  "reduce": {
    "strategy": "hierarchical",
    "prompt": "Compile into a prioritized report."
  }
}
```

Tree reduction with fan-in of 20:
```
Level 0: 120 results → 6 groups of 20
Level 1: 6 summaries → 1 final report
```

Each level runs its groups in parallel (all 6 group summaries computed concurrently).

### Using a Different Reduce Agent

You can use a different agent for reduction than for the map workers:

```json
{
  "agent": "coder",
  "reduce": {
    "strategy": "summarize",
    "agent": "writer",
    "prompt": "Write an executive report..."
  }
}
```

This sends batches to `@coder` (fast, technical) but the final synthesis to `@writer` (better at prose).

---

## Shuffle: Cross-Batch Comparison

### The Problem

When you split 3000 PRs into 120 batches, potential duplicates can land in different batches:

```
Batch 3:   PR#42  {intent: "fix auth token refresh", tags: ["auth", "bugfix"]}
Batch 95:  PR#1876 {intent: "fix auth token renewal", tags: ["auth", "security"]}
```

Without shuffle, these are processed by different workers and never compared.

With hierarchical reduce, they're further separated:
```
Group 1 (batches 1-20):  → "No duplicates found in batch 3 results"
Group 5 (batches 81-100): → "No duplicates found in batch 95 results"
Final merge: → "No duplicates detected"  ← WRONG
```

### The Solution

The shuffle phase re-groups map outputs by a shared attribute (like semantic tags). Since both PR#42 and PR#1876 have the tag `"auth"`, they end up in the same `"auth"` partition:

```
Partition "auth": [PR#42, PR#1876, PR#99, PR#201, ...]
  → Reducer sees them side-by-side
  → "Duplicates found: #42 ↔ #1876 (both fix auth token refresh)"
```

### multi_key: Ensuring Complete Coverage

A PR can have multiple tags. With `multi_key: "duplicate"` (default), PR#42 with `tags: ["auth", "bugfix"]` appears in BOTH:
- `"auth"` partition
- `"bugfix"` partition

This means if PR#42 and PR#55 only share the tag `"bugfix"` (not `"auth"`), they'll still be compared in the `"bugfix"` partition.

The final merge step deduplicates findings — if the same pair is reported from multiple partitions, only one entry appears in the final report.

### Choosing a Shuffle Key

| Key field | Good for | Example values |
|-----------|----------|----------------|
| `tags` | General-purpose semantic grouping | `["auth", "api", "bugfix"]` |
| `key_files` | File-based conflict detection | `["src/auth.ts", "package.json"]` |
| `category` | Pre-categorized items | `"billing"`, `"user-management"` |
| `author` | Per-author analysis | `"jane"`, `"bob"` |

**Best practice**: Use an array-valued field with `multi_key: "duplicate"` for maximum coverage. Scalar fields (single value) are simpler but may miss relationships.

### When Shuffle Is Needed vs Not

| Task | Needs Shuffle? | Why |
|------|---------------|-----|
| Summarize all PRs | No | Each batch summary is independent |
| **Find duplicates** | **Yes** | Duplicates may be in different batches |
| Classify items | No | Each item classified independently |
| **Find conflicts** | **Yes** | Conflicting items may be in different batches |
| Count items by category | No | Batch counts can be summed |
| **Find patterns** across items | **Yes** | Patterns require seeing related items together |
| Review/audit each item | No | Each item reviewed on its own |

**Rule of thumb**: If the task requires comparing items against each other, you need shuffle. If each item is processed independently, you don't.

---

## CLI Commands

```bash
# List all configured swarms
tinyclaw swarm list

# Add a new swarm interactively
tinyclaw swarm add

# Show a swarm's configuration
tinyclaw swarm show <swarm_id>

# Remove a swarm
tinyclaw swarm remove <swarm_id>

# Trigger a swarm job from the command line
tinyclaw swarm run <swarm_id> "<message>"
```

### Examples

```bash
# Review PRs
tinyclaw swarm run pr-reviewer "review PRs in facebook/react"

# Find duplicates
tinyclaw swarm run pr-dedup "find duplicate PRs in owner/repo"

# Analyze logs
tinyclaw swarm run log-analyzer "analyze errors from the last 24h"
```

When triggered via CLI, the message is queued just like a channel message. Results appear in the outgoing queue and are delivered to the channel context (or just written to the queue output for CLI-triggered jobs).

---

## Examples

### PR Review Swarm

Review thousands of PRs with risk assessment:

```json
{
  "pr-reviewer": {
    "name": "PR Reviewer",
    "agent": "coder",
    "concurrency": 10,
    "batch_size": 30,
    "input": {
      "command": "gh pr list --repo {{repo}} --state open --limit 5000 --json number,title,url,additions,deletions,changedFiles,labels",
      "type": "json_array"
    },
    "prompt_template": "You are reviewing pull requests. For each PR below, analyze the metadata and provide:\n1. **Summary**: One-line description\n2. **Risk**: low/medium/high based on size and changed files\n3. **Action**: approve/review/discuss\n4. **Priority**: 1-5 (5 = urgent)\n\nPRs (batch {{batch_number}} of {{total_batches}}):\n{{items}}",
    "reduce": {
      "strategy": "hierarchical",
      "prompt": "Create an executive summary of these PR reviews. Include:\n- Total PR counts by risk level\n- Top 10 highest priority PRs needing immediate attention\n- Patterns observed (common issues, active areas of codebase)\n- Recommended review order"
    }
  }
}
```

### PR Duplicate Finder (with Shuffle)

Find duplicate and conflicting PRs using shuffle for cross-batch comparison:

```json
{
  "pr-dedup": {
    "name": "PR Duplicate Finder",
    "agent": "coder",
    "concurrency": 10,
    "batch_size": 50,
    "input": {
      "command": "gh pr list --repo {{repo}} --state open --limit 5000 --json number,title,url,body,headRefName,files,additions,deletions",
      "type": "json_array"
    },
    "prompt_template": "For each PR, extract a structured fingerprint for duplicate detection. Output ONLY a JSON array where each entry has:\n- pr_number (number)\n- title (string)\n- intent (1-sentence summary of what this PR does)\n- key_files (array of primary files changed)\n- tags (3-5 semantic keywords, e.g. 'auth', 'bugfix', 'api', 'refactor')\n\nPRs (batch {{batch_number}}/{{total_batches}}):\n{{items}}",
    "shuffle": {
      "key_field": "tags",
      "multi_key": "duplicate",
      "max_partition_size": 200,
      "reduce_prompt": "Find duplicate and near-duplicate PRs among these {{item_count}} items sharing the tag \"{{partition_key}}\".\n\nCompare by: similar intent, overlapping key_files, similar titles.\nFor each duplicate pair/group: PR numbers, why they're duplicates, which to keep.\nIf none found, say 'No duplicates in this partition.'\n\n{{items}}",
      "merge_prompt": "Merge duplicate detection results from multiple partitions. Some duplicates appear in multiple partitions (PRs share multiple tags). Consolidate into:\n\n## Exact Duplicates\n## Near Duplicates\n## Conflicting PRs\n\nFor each group: PR numbers/titles, explanation, recommended action."
    },
    "reduce": {
      "strategy": "summarize"
    }
  }
}
```

**How it works:**
1. **Map**: 10 workers extract compact JSON fingerprints from 50 PRs each (60 batches)
2. **Shuffle**: Fingerprints re-grouped by `tags` — all "auth" PRs together, all "bugfix" PRs together. PRs with multiple tags appear in multiple partitions.
3. **Partition Reduce**: Each tag group checked for duplicates independently (parallel)
4. **Final Merge**: Findings from all partitions merged and deduplicated

### Log Analyzer Swarm

```json
{
  "log-analyzer": {
    "name": "Log Analyzer",
    "agent": "analyst",
    "concurrency": 8,
    "batch_size": 100,
    "input": {
      "command": "cat /var/log/app/error.log | tail -10000",
      "type": "lines"
    },
    "prompt_template": "Analyze these error log entries. Group by error type, identify patterns, and flag critical issues.\n\nLog entries:\n{{items}}",
    "reduce": {
      "strategy": "summarize",
      "prompt": "Synthesize these log analysis results into an incident report with: root causes, affected systems, timeline, and recommended fixes."
    }
  }
}
```

### Document Summarizer

```json
{
  "doc-summarizer": {
    "name": "Document Summarizer",
    "agent": "writer",
    "concurrency": 5,
    "batch_size": 10,
    "prompt_template": "Summarize each document in 2-3 sentences. Preserve key facts and findings.\n\nDocuments:\n{{items}}",
    "reduce": {
      "strategy": "summarize",
      "prompt": "Create a comprehensive literature review from these document summaries. Identify themes, conflicts, and gaps."
    }
  }
}
```

### Security Audit Swarm (with Shuffle)

Find related security issues across a codebase:

```json
{
  "security-audit": {
    "name": "Security Auditor",
    "agent": "coder",
    "concurrency": 8,
    "batch_size": 20,
    "input": {
      "command": "find {{path}} -name '*.ts' -o -name '*.js' | head -2000",
      "type": "lines"
    },
    "prompt_template": "Audit each file for security issues. For each file, output a JSON array where each finding has:\n- file (string)\n- line (number, approximate)\n- severity (critical/high/medium/low)\n- category (e.g. 'injection', 'auth', 'crypto', 'xss', 'exposure')\n- description (1 sentence)\n\nIf no issues found, output an empty array [].\n\nFiles to audit:\n{{items}}",
    "shuffle": {
      "key_field": "category",
      "multi_key": "first",
      "reduce_prompt": "Analyze these {{item_count}} security findings in the \"{{partition_key}}\" category. Identify:\n- Attack chains (multiple findings that combine into a larger vulnerability)\n- Root causes (shared patterns causing multiple findings)\n- Priority order for remediation\n\n{{items}}",
      "merge_prompt": "Compile all security findings into a final audit report:\n\n## Critical Findings\n## Attack Chains\n## Remediation Roadmap (ordered by priority)\n## Summary Statistics"
    },
    "reduce": {
      "strategy": "summarize"
    }
  }
}
```

---

## Queue Integration

Swarms integrate seamlessly with TinyClaw's existing file-based queue system:

1. **Routing**: When a message starts with `@swarm_id`, the queue processor detects it as a swarm target (checked before agent/team routing). The `@swarm_id` prefix is stripped and the rest of the message is passed to the swarm processor.

2. **Promise chains**: Swarm jobs use a dedicated chain key (`swarm:<id>`) in the queue processor's `agentProcessingChains` map. This means a running swarm job does not block the underlying worker agent's regular message processing.

3. **Progress updates**: Written as regular `ResponseData` JSON files to `~/.tinyclaw/queue/outgoing/` (prefixed `swarm_progress_`). Channel clients pick them up and deliver them like normal messages.

4. **Final results**: Written to `~/.tinyclaw/queue/outgoing/` (prefixed `swarm_result_`). Long results are saved as `.md` files in `~/.tinyclaw/files/` and attached.

5. **Agent invocations**: Each batch uses the existing `invokeAgent()` function from `src/lib/invoke.ts`, which handles Claude CLI and Codex CLI dispatching, workspace management, and conversation reset.

---

## Events & Monitoring

The swarm processor emits events to `~/.tinyclaw/events/` throughout the job lifecycle. These events drive the TUI visualizer and can be used for custom monitoring.

| Event | When | Key data |
|-------|------|----------|
| `swarm_job_start` | Job begins | `jobId`, `swarmId`, `swarmName`, `channel`, `sender` |
| `swarm_split_done` | Items split into batches | `totalItems`, `totalBatches`, `batchSize` |
| `swarm_pool_start` | Worker pool begins | `totalBatches`, `concurrency` |
| `swarm_batch_start` | Single batch starts | `batchIndex`, `batchSize`, `attempt` |
| `swarm_batch_done` | Single batch completes | `batchIndex`, `success`, `duration`, `completed`, `failed`, `total` |
| `swarm_pool_done` | All batches complete | `completed`, `failed`, `total` |
| `swarm_shuffle_done` | Shuffle completes | `partitions`, `totalItems`, `unkeyedItems`, `duplicatedItems` |
| `swarm_shuffle_reduce_start` | Partition reduction begins | `partitionCount`, `unkeyedCount` |
| `swarm_shuffle_reduce_done` | Partition reduction completes | `partitionCount` |
| `swarm_reduce_start` | Reduction begins | `strategy`, `batchCount` |
| `swarm_reduce_done` | Reduction completes | `strategy`, `resultLength` |
| `swarm_job_done` | Job succeeds | `duration`, `totalBatches`, `successBatches`, `failedBatches`, `resultLength` |
| `swarm_job_failed` | Job fails | `error` |

---

## Tuning Guide

### Choosing `batch_size`

| Scenario | Recommended | Why |
|----------|-------------|-----|
| Small items (URLs, IDs, one-liners) | 50–100 | Small token footprint per item |
| Medium items (PR metadata with title, body snippet) | 20–30 | Moderate token usage |
| Large items (full PR diffs, documents) | 5–10 | Each item consumes significant tokens |
| Items needing detailed analysis | 10–15 | Give the model room to think per item |

**Rule of thumb**: Keep each batch prompt under ~50K tokens total. If your items are ~500 tokens each, batch_size of 25 = ~12.5K tokens per batch prompt (comfortable).

### Choosing `concurrency`

| Constraint | Recommended | Why |
|-----------|-------------|-----|
| API rate limits | 3–5 | Avoid hitting per-minute/per-hour limits |
| Shared agent workspace | 5–10 | All workers share one agent's cwd |
| Dedicated compute | 10–20 | No contention for resources |
| Maximum throughput | 15–20 | Diminishing returns beyond this |

**Note**: All concurrent workers invoke the same agent (same provider, model, workspace). If you hit API rate limits, reduce concurrency or use a provider with higher limits.

### Choosing `reduce.strategy`

| Total batch results | Combined size estimate | Strategy |
|--------------------|-----------------------|----------|
| < 10 | < 100K chars | `summarize` |
| 10–50 | 100K–600K chars | `summarize` (auto-falls back) |
| 50–500 | 600K+ chars | `hierarchical` |
| Any (cross-referencing) | Any | `shuffle` |

### Shuffle Performance

The shuffle phase has its own costs:
- **Parsing**: O(n) where n = total items across all batches. Fast.
- **Partition reduce**: Each partition is an agent invocation. More unique keys = more invocations.
- **Final merge**: One agent invocation.

To optimize shuffle:
- Use a key field with moderate cardinality (10–100 unique keys is ideal)
- Set `max_partition_size` to keep partitions within context limits
- Use `multi_key: "first"` if you're confident the first key is sufficient

---

## Limits & Defaults

| Parameter | Default | Hard limit | Configurable |
|-----------|---------|-----------|-------------|
| Max items per job | — | 10,000 | Change `SWARM_DEFAULTS.max_items` |
| Concurrency | 5 | No hard limit | `concurrency` |
| Batch size | 25 | No hard limit | `batch_size` |
| Max retries per batch | 2 | — | `SWARM_DEFAULTS.max_retries` |
| Retry backoff | 2s, 4s | — | Exponential, not configurable |
| Hierarchical fan-in | 20 | — | `SWARM_DEFAULTS.hierarchical_reduce_fanin` |
| Max partition size (shuffle) | 200 | — | `shuffle.max_partition_size` |
| Progress interval | 10 batches | — | `progress_interval` |
| Long response threshold | 4000 chars | — | Saves as file if exceeded |
| Job retention in memory | 5 minutes | — | For status queries |
| Input command timeout | 120 seconds | — | — |

---

## Source Files

| File | Purpose |
|------|---------|
| `src/swarm/types.ts` | `SwarmConfig`, `SwarmJob`, `SwarmBatch`, `BatchResult`, `SWARM_DEFAULTS` |
| `src/swarm/batch-splitter.ts` | Input resolution (5 sources), template params, batch splitting |
| `src/swarm/worker-pool.ts` | Semaphore-bounded concurrent batch processing with retries |
| `src/swarm/reducer.ts` | Three strategies: concatenate, summarize, hierarchical tree |
| `src/swarm/shuffle.ts` | Map output parsing, key extraction, partitioning, partition reduce, merge |
| `src/swarm/swarm-processor.ts` | End-to-end pipeline orchestrator, progress updates, output handling |
| `src/queue-processor.ts` | Swarm routing detection (`@swarm_id`), dedicated promise chains |
| `src/lib/config.ts` | `getSwarms()` config helper |
| `src/lib/types.ts` | `Settings.swarms` field |
| `lib/swarm.sh` | CLI commands: list, add, remove, show, run |
| `tinyclaw.sh` | CLI dispatcher for `swarm` subcommand |
