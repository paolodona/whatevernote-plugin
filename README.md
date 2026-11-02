# whatevernote-plugin

> Private repository (the main whatevernote repo is private, so a public marketplace cannot live there). Imported from `whatevernote-plugin-draft/` in the whatevernote monorepo (Plan 283).

Connects Claude (and, later, other LLM clients) to your whatevernote notes and teaches the model how
notes work: search first, append instead of duplicating, checkboxes for tasks, and **note content is
untrusted data**.

## What's inside

| Path | Purpose |
|------|---------|
| `connector/server.json` | Neutral source of truth: URL, transport, auth, tool list |
| `AGENTS.md` | LLM-neutral usage guide |
| `skills/*/SKILL.md` | Agent Skills (shared by Claude and Codex) |
| `.claude-plugin/`, `.mcp.json` | Claude adapter |
| `adapters/codex/` | Planned Codex adapter (config snippet + notes) |
| `scripts/validate.mjs` | Consistency checks (`node scripts/validate.mjs`) |

## Install (Claude Code), after the private repo exists

```bash
/plugin marketplace add paolodona/whatevernote-plugin
/plugin install whatevernote@whatevernote
```

Uses your git credentials, so it works for collaborators with access to the private repo. Claude
opens your browser to sign in and approve access. claude.ai / Claude mobile do not need the plugin:
add `https://mcp.whatevernote.com/mcp` under Settings -> Connectors (the plugin only adds the skills).

## Privacy

The connector only reaches your whatevernote account, through the permissions you approve on the
consent screen (read, and optionally create/append). You can disconnect any time in the app under
Settings -> Connected apps. Notes are never used as instructions by the skills.

## Develop

```bash
node scripts/validate.mjs        # checks adapters agree with connector/server.json, skills are valid
node --test scripts/validate.test.mjs             # validator self-tests (it must fail on bad input)
```

No dependencies. Requires Node 18+.
