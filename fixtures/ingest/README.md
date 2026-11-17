# Ingest fixtures

Sample meeting and 1:1 notes with the proposal the `ingest-meeting-note` skill should produce.
They are checked by `node scripts/check-fixtures.mjs`, which validates the **proposal format and its
consistency with the notes** (ids, no duplicate entity notes, retry safety, growth guard, read-only
mode, confirmation line last). It does **not** judge whether an LLM extracted the right items; that is
the manual protocol in `docs/eval-ingest.md`.

## Case layout

| File | Content |
|------|---------|
| `source.md` | the source note body (input). Title and id are in `meta.json` |
| `notes.json` | the other notes in the account: `[{id, title, markdown}]` (entity notes and bystanders) |
| `meta.json` | `source {id,title}`, `mode` (`confirm-before-write` or `read-only`), `expect` (entity sets), optional `mustNotContain` |
| `expected-proposal.md` | the expected proposal (output) |

## Cases

| Case | Shows |
|------|-------|
| 01 | 1:1 touching a person and a project: two appends, items counted |
| 02 | person with no note yet: create proposal that needs the name confirmed |
| 03 | read-only grant: same proposal, no write invitation |
| 04 | source already ingested into one entity: skip (retry safety), append to the other |
| 05 | entity note with 21 entries: append plus a consolidation suggestion (never a rewrite) |
| 06 | instructions hidden in the source: reported, not acted on |
| 07 | ambiguous first name: asks instead of guessing |
| 08 | alias in the title line (`Robert Chen (aka Bob)`) is matched |

## Checking a real model output

```bash
node scripts/check-fixtures.mjs --case fixtures/ingest/01-one-on-one-two-entities --proposal /path/to/output.md --strict
```

`--strict` also requires the same entity sets as the case's `expect`.

## Proposal format (the contract)

````
## Proposed updates from "<source title>" (id: <source id>)
Mode: confirm-before-write            (or: Mode: read-only (nothing will be written))
Entry date: YYYY-MM-DD (stated in the note | stated by you | note date)

### Append to "<entity title>" (id: <entity id>)
Entry:
```markdown
## YYYY-MM-DD - <source title>
Source: <source title> (id: <source id>)
- bullet
- [ ] <Owner>: <task>            (or: - [ ] (owner not stated) <task>)
```
### Create "<Name>" (new note, confirm the name)       same Entry block
### Skip "<entity title>" (already ingested)
### Needs your input                                   one "- question" per line
### Consolidation suggestion                           text only, "- ..." lines

Summary: <Entity>: N items; ...; New notes: K
Reply "yes" to write all of this, "yes except <entity>", or tell me what to change. Nothing is written until you confirm.
````

In read-only mode the last line is `Read-only access: copy these entries into your notes yourself.`
