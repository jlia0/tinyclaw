---
name: skills-manager
description: "Search for and install skills from the skills registry to agent workspaces. Use when the agent needs to: find available skills, search for skills by keyword, install a skill to a specific agent's workspace, list skills installed on an agent, or manage skill availability across agents. Triggers: 'search skills', 'find a skill', 'install skill', 'add skill to agent', 'what skills are available', 'skill registry', 'browse skills'."
---

# Skills Manager

Search the skills registry and install skills to agent workspaces.

## Available operations

### Search skills

Search the registry for skills matching a query:

```bash
bash .agents/skills/skills-manager/scripts/skills-manager.sh search <query> [agent_id]
```

- `query` — keyword to search for (e.g. "seo", "pdf", "browser")
- `agent_id` — optional; agent whose workspace to run the search from (defaults to current agent via settings)

### Install a skill

Install a skill from the registry to an agent's workspace:

```bash
bash .agents/skills/skills-manager/scripts/skills-manager.sh install <skill_ref> <agent_id>
```

- `skill_ref` — skill reference from search results (e.g. "@anthropic/seo" or a GitHub URL)
- `agent_id` — the agent to install the skill to

### List installed skills

List skills currently installed in an agent's workspace:

```bash
bash .agents/skills/skills-manager/scripts/skills-manager.sh list [agent_id]
```

If `agent_id` is omitted, lists skills for all agents.

## Workflow

1. **Search** the registry to find a skill: `skills-manager.sh search "image editing"`
2. Review the results — note the skill reference string
3. **Install** it to the target agent: `skills-manager.sh install <ref> <agent_id>`
4. Verify with **list**: `skills-manager.sh list <agent_id>`

## Notes

- The TinyAGI API must be running (`tinyagi start`) for search and install via API
- Search uses the `skills` CLI under the hood (auto-installed via npx)
- Install places skills into the agent's `.agents/skills/` directory
- Installed skills are automatically available to the agent on its next invocation
