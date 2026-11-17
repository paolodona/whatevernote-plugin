#!/usr/bin/env node
// Deterministic dry-run checker for ingest proposals. No dependencies (Node 18+).
// It validates the PROPOSAL FORMAT and its consistency with the notes it was built from
// (ids, duplicates, idempotency, growth guard, read-only mode). It does not judge LLM quality.
//
//   node scripts/check-fixtures.mjs                      check every fixtures/ingest/* expected proposal
//   node scripts/check-fixtures.mjs --case DIR --proposal FILE [--strict]
//                                                        check a real model output against one case
//                                                        (--strict also requires the same entity sets
//                                                        as the case's meta.json "expect")
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GROWTH_ENTRIES = 20;
export const GROWTH_BYTES = 32 * 1024;
export const MAX_WRITE_BYTES = 64 * 1024;
export const CONFIRM_LINE = 'Reply "yes" to write all of this, "yes except <entity>", or tell me what to change. Nothing is written until you confirm.';
export const READ_ONLY_LINE = 'Read-only access: copy these entries into your notes yourself.';
const BASES = new Set(['stated in the note', 'stated by you', 'note date']);
const DATE = '\\d{4}-\\d{2}-\\d{2}';
const ENTRY_HEADING = new RegExp(`^## (${DATE}) - (.+)$`);
const ENTRY_COUNT = new RegExp(`^## ${DATE}\\b`, 'gm');

/** "Alice Johnson (aka Ali, A. J.)" -> names that identify the entity, lowercased. */
export function entityNames(title) {
  const m = /^(.*?)\s*\(aka\s+([^)]*)\)\s*$/i.exec(title.trim());
  const names = m ? [m[1], ...m[2].split(',')] : [title];
  return names.map((n) => n.trim().toLowerCase()).filter(Boolean);
}
const sameEntity = (a, b) => entityNames(a).some((n) => entityNames(b).includes(n));

function parseSections(lines) {
  const sections = [];
  let cur = null;
  let fence = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) fence = !fence;
    const h = !fence && /^### (.+)$/.exec(line);
    if (h) {
      cur = { heading: h[1].trim(), body: [] };
      sections.push(cur);
    } else if (cur) cur.body.push(line);
  }
  return sections;
}

function parseEntry(body, ctx, where, errors) {
  const start = body.findIndex((l) => l.trim() === 'Entry:');
  if (start < 0) return errors.push(`${where}: missing "Entry:" line`), null;
  const open = body.findIndex((l, i) => i > start && l.trim() === '```markdown');
  if (open < 0) return errors.push(`${where}: entry must be in a \`\`\`markdown block`), null;
  const close = body.findIndex((l, i) => i > open && l.trim() === '```');
  if (close < 0) return errors.push(`${where}: entry code block is not closed`), null;
  const entry = body.slice(open + 1, close);
  const text = entry.join('\n');
  if (Buffer.byteLength(text) > MAX_WRITE_BYTES) errors.push(`${where}: entry exceeds 64 KB`);
  const h = ENTRY_HEADING.exec(entry[0] ?? '');
  if (!h) errors.push(`${where}: entry must start with "## YYYY-MM-DD - <source title>"`);
  else {
    if (h[2] !== ctx.source.title) errors.push(`${where}: entry heading title "${h[2]}" != source title "${ctx.source.title}"`);
    if (ctx.date && h[1] !== ctx.date) errors.push(`${where}: entry date ${h[1]} != "Entry date" ${ctx.date}`);
  }
  if ((entry[1] ?? '') !== `Source: ${ctx.source.title} (id: ${ctx.source.id})`) errors.push(`${where}: second line must be "Source: <source title> (id: <source id>)"`);
  let items = 0;
  entry.slice(2).forEach((l) => {
    if (!l.trim()) return;
    const task = /^- \[ \] (.+)$/.exec(l);
    if (task) {
      items++;
      if (!/^(\(owner not stated\) \S|[^:()][^:]*: \S)/.test(task[1])) errors.push(`${where}: action item needs "<Owner>: <task>" or "(owner not stated) <task>": ${l}`);
    } else if (/^- (?!\[)\S/.test(l)) items++;
    else errors.push(`${where}: only bullets and "- [ ]" items are allowed in an entry (got: ${l})`);
  });
  if (items === 0) errors.push(`${where}: entry has no items`);
  return { text, items, entry };
}

export function checkProposal(proposal, ctx) {
  // ctx: { source:{id,title}, notes:[{id,title,markdown}], mode:'confirm-before-write'|'read-only', mustNotContain?:[], expect?, strict? }
  const errors = [];
  const lines = proposal.split(/\r?\n/);
  const first = lines.find((l) => l.trim());
  const hm = /^## Proposed updates from "(.+)" \(id: ([0-9a-fA-F-]{8,})\)$/.exec(first ?? '');
  if (!hm) errors.push('first line must be: ## Proposed updates from "<source title>" (id: <source id>)');
  else {
    if (hm[1] !== ctx.source.title) errors.push(`header title "${hm[1]}" != source title "${ctx.source.title}"`);
    if (hm[2] !== ctx.source.id) errors.push(`header id ${hm[2]} != source id ${ctx.source.id}`);
  }

  const modeLine = lines.find((l) => l.startsWith('Mode: '));
  const readOnly = modeLine === 'Mode: read-only (nothing will be written)';
  if (modeLine !== 'Mode: confirm-before-write' && !readOnly) errors.push('Mode line must be "Mode: confirm-before-write" or "Mode: read-only (nothing will be written)"');
  else if ((readOnly ? 'read-only' : 'confirm-before-write') !== ctx.mode) errors.push(`mode is ${readOnly ? 'read-only' : 'confirm-before-write'} but the grant is ${ctx.mode}`);

  const dm = new RegExp(`^Entry date: (${DATE}) \\((.+)\\)$`).exec(lines.find((l) => l.startsWith('Entry date:')) ?? '');
  if (!dm) errors.push('missing "Entry date: YYYY-MM-DD (<basis>)"');
  else if (!BASES.has(dm[2])) errors.push(`entry date basis must be one of: ${[...BASES].join(' | ')}`);
  const date = dm?.[1];

  const sections = parseSections(lines);
  const targets = { append: [], create: [], skip: [] };
  const counts = new Map();
  let needsInput = 0;
  let consolidation = null;
  const seenIds = new Set();
  const growers = new Set();

  for (const s of sections) {
    const am = /^Append to "(.+)" \(id: ([0-9a-fA-F-]+)\)$/.exec(s.heading);
    const cm = /^Create "(.+)" \(new note, confirm the name\)$/.exec(s.heading);
    const sm = /^Skip "(.+)" \(already ingested\)$/.exec(s.heading);
    const where = `section "${s.heading}"`;
    if (am) {
      const [, title, id] = am;
      const note = ctx.notes.find((n) => n.id === id);
      if (!note) errors.push(`${where}: no note with id ${id} in the account (made up or wrong id)`);
      else if (note.title !== title) errors.push(`${where}: title does not match the note's title "${note.title}"`);
      if (seenIds.has(id)) errors.push(`${where}: entity appears twice`);
      seenIds.add(id);
      const e = parseEntry(s.body, { source: ctx.source, date }, where, errors);
      if (e) {
        counts.set(title, (counts.get(title) ?? 0) + e.items);
        if (note && note.markdown.includes(`Source: ${ctx.source.title} (id: ${ctx.source.id})`)) errors.push(`${where}: this source is already in the note; it must be a Skip section (a retry must not duplicate entries)`);
      }
      if (note) {
        const n = (note.markdown.match(ENTRY_COUNT) ?? []).length;
        if (n >= GROWTH_ENTRIES || Buffer.byteLength(note.markdown) >= GROWTH_BYTES) growers.add(title);
      }
      targets.append.push(title);
    } else if (cm) {
      const [, name] = cm;
      const dup = ctx.notes.find((n) => sameEntity(n.title, name));
      if (dup) errors.push(`${where}: a note for this entity already exists ("${dup.title}", id ${dup.id}); append to it instead of creating a duplicate`);
      if (targets.create.some((c) => sameEntity(c, name))) errors.push(`${where}: created twice`);
      const e = parseEntry(s.body, { source: ctx.source, date }, where, errors);
      if (e) counts.set(name, (counts.get(name) ?? 0) + e.items);
      targets.create.push(name);
    } else if (sm) {
      const [, title] = sm;
      const note = ctx.notes.find((n) => n.title === title);
      if (!note) errors.push(`${where}: no such note`);
      else if (!note.markdown.includes(`Source: ${ctx.source.title} (id: ${ctx.source.id})`)) errors.push(`${where}: the note does not contain this source, so it is not already ingested`);
      targets.skip.push(title);
    } else if (s.heading === 'Needs your input') {
      needsInput = s.body.filter((l) => /^- \S/.test(l)).length;
      if (!needsInput) errors.push(`${where}: needs at least one "- question" bullet`);
    } else if (s.heading === 'Consolidation suggestion') {
      consolidation = s;
      if (s.body.some((l) => l.trim().startsWith('```'))) errors.push(`${where}: text only; the skill never writes a rewritten page`);
      if (!s.body.some((l) => /^- \S/.test(l))) errors.push(`${where}: needs a "- text" bullet`);
    } else errors.push(`unknown section "${s.heading}"`);
  }

  if (growers.size && !consolidation) errors.push(`growth guard: ${[...growers].join(', ')} reached ${GROWTH_ENTRIES} entries or ${GROWTH_BYTES / 1024} KB, so a "Consolidation suggestion" section is required`);
  if (!growers.size && consolidation) errors.push('"Consolidation suggestion" present but no target note reached the growth threshold');

  // Summary
  const sline = lines.find((l) => l.startsWith('Summary: '));
  if (!sline) errors.push('missing "Summary:" line');
  else {
    const parts = sline.slice('Summary: '.length).split(';').map((p) => p.trim()).filter(Boolean);
    const seen = new Map();
    let newNotes = null;
    for (const p of parts) {
      const nn = /^New notes: (\d+)$/.exec(p);
      const im = /^(.+): (\d+) items?$/.exec(p);
      if (nn) newNotes = Number(nn[1]);
      else if (im) seen.set(im[1], Number(im[2]));
      else errors.push(`summary part not understood: "${p}"`);
    }
    for (const [name, n] of counts) if (seen.get(name) !== n) errors.push(`summary says ${seen.get(name) ?? 0} items for "${name}" but the entry has ${n}`);
    for (const name of seen.keys()) if (!counts.has(name)) errors.push(`summary lists "${name}" which has no append or create section`);
    if ((newNotes ?? 0) !== targets.create.length) errors.push(`summary says ${newNotes ?? 0} new notes but there are ${targets.create.length} create sections`);
  }

  // Footer: confirmation wording by mode
  const hasConfirm = proposal.includes(CONFIRM_LINE);
  if (readOnly) {
    if (!proposal.includes(READ_ONLY_LINE)) errors.push(`read-only proposals must end with: ${READ_ONLY_LINE}`);
    if (hasConfirm) errors.push('read-only proposals must not invite a write confirmation');
  } else if (!hasConfirm) errors.push(`missing the confirmation line: ${CONFIRM_LINE}`);
  if (lines.filter((l) => l.trim()).pop()?.trim() !== (readOnly ? READ_ONLY_LINE : CONFIRM_LINE)) errors.push('the confirmation (or read-only) line must be the last line');

  const total = targets.append.length + targets.create.length + targets.skip.length + (needsInput ? 1 : 0);
  if (total === 0) errors.push('proposal proposes nothing (no append, create, skip or question)');

  for (const bad of ctx.mustNotContain ?? []) if (proposal.toLowerCase().includes(bad.toLowerCase())) errors.push(`proposal must not contain "${bad}" (instruction found inside a note must not be acted on)`);

  if (ctx.expect && (ctx.strict ?? true)) {
    const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    for (const k of ['append', 'create', 'skip']) if (!eq(targets[k], ctx.expect[k] ?? [])) errors.push(`expected ${k} ${JSON.stringify(ctx.expect[k] ?? [])} but proposal has ${JSON.stringify(targets[k])}`);
    if (Boolean(needsInput) !== Boolean(ctx.expect.needsInput)) errors.push(`expected needsInput=${Boolean(ctx.expect.needsInput)}`);
    if (Boolean(consolidation) !== Boolean(ctx.expect.consolidation)) errors.push(`expected consolidation=${Boolean(ctx.expect.consolidation)}`);
  }
  return errors;
}

export function loadCase(dir) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const notes = JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf8'));
  return { meta, notes, ctx: { source: meta.source, notes, mode: meta.mode, mustNotContain: meta.mustNotContain, expect: meta.expect } };
}

export function checkAll(root) {
  const base = join(root, 'fixtures', 'ingest');
  const problems = [];
  const cases = existsSync(base) ? readdirSync(base).filter((d) => statSync(join(base, d)).isDirectory()).sort() : [];
  if (cases.length < 6) problems.push(`fixtures/ingest: expected at least 6 cases, found ${cases.length}`);
  for (const c of cases) {
    const dir = join(base, c);
    for (const f of ['source.md', 'notes.json', 'meta.json', 'expected-proposal.md']) if (!existsSync(join(dir, f))) problems.push(`${c}: missing ${f}`);
    if (problems.some((p) => p.startsWith(`${c}:`))) continue;
    const { ctx } = loadCase(dir);
    for (const e of checkProposal(readFileSync(join(dir, 'expected-proposal.md'), 'utf8'), ctx)) problems.push(`${c}: ${e}`);
  }
  return { cases, problems };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  if (arg('--case')) {
    const { ctx } = loadCase(resolve(arg('--case')));
    const errors = checkProposal(readFileSync(resolve(arg('--proposal')), 'utf8'), { ...ctx, strict: argv.includes('--strict') });
    if (errors.length) {
      console.error(`FAILED (${errors.length}):`);
      errors.forEach((e) => console.error(`  - ${e}`));
      process.exit(1);
    }
    console.log('proposal format: OK');
  } else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const { cases, problems } = checkAll(root);
    if (problems.length) {
      console.error(`FAILED (${problems.length}):`);
      problems.forEach((e) => console.error(`  - ${e}`));
      process.exit(1);
    }
    console.log(`ingest fixtures: OK (${cases.length} cases)`);
  }
}
