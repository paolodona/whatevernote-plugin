# Development

Maintainer docs. Nothing in this file ships to users: Claude installs only
`plugins/whatevernote/` (see `.claude-plugin/marketplace.json`).

> Private repository (the main whatevernote repo is private, so a public marketplace cannot live
> there). Imported from `whatevernote-plugin-draft/` in the whatevernote monorepo (Plan 283).
> Installing needs git access to this repo.

## Layout

| Path | Ships to users? | Purpose |
|------|-----------------|---------|
| `plugins/whatevernote/` | **yes** | The Claude plugin: `.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, user `README.md` |
| `.claude-plugin/marketplace.json` | listing | Points at `plugins/whatevernote` |
| `connector/server.json` | no | Neutral source of truth: URL, transport, auth, tool list |
| `AGENTS.md` | no | LLM-neutral usage guide (Codex etc.) |
| `adapters/codex/` | no | Planned Codex adapter |
| `scripts/` | no | Validator and its tests |

Rule of thumb: anything a user should see goes in `plugins/whatevernote/`; anything about
building, verifying or hosting the plugin goes outside it. Skill bodies are instructions for the
model, not user docs, so keep them free of maintainer notes.

## Ingest fixtures and manual eval

`fixtures/ingest/` holds sample notes and expected proposals for the `ingest-meeting-note` skill (kept outside
`plugins/` so they never ship). `docs/eval-ingest.md` is the owner dry-run protocol.

## Checks

```bash
node scripts/validate.mjs                 # adapters agree with connector/server.json, skills valid,
                                          # plugin folder holds no dev-only content
node --test scripts/validate.test.mjs     # validator self-tests (must fail on bad input)
node scripts/check-fixtures.mjs           # ingest proposal-format checker on the fixtures
node --test scripts/check-fixtures.test.mjs  # checker self-tests
```

No dependencies. Requires Node 18+.
