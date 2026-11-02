// Self-tests: the validator must pass on the real plugin and FAIL on each kind of breakage.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function withCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'wn-plugin-'));
  cpSync(ROOT, dir, { recursive: true, filter: (s) => !s.includes('node_modules') });
  try {
    mutate(dir);
    return validate(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const edit = (dir, rel, fn) => writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), 'utf8')));

test('the real plugin validates', () => {
  assert.deepEqual(validate(ROOT), []);
});

test('adapter url drift is caught (.mcp.json and codex)', () => {
  assert.ok(withCopy((d) => edit(d, '.mcp.json', (t) => t.replace('mcp.whatevernote.com', 'evil.example'))).some((e) => e.includes('.mcp.json: url')));
  assert.ok(withCopy((d) => edit(d, 'adapters/codex/config.toml', (t) => t.replace('mcp.whatevernote.com', 'evil.example'))).some((e) => e.includes('codex')));
});

test('credentials in .mcp.json are rejected', () => {
  const errs = withCopy((d) => edit(d, '.mcp.json', (t) => t.replace('"type": "http"', '"type": "http", "headers": {"Authorization": "Bearer x"}')));
  assert.ok(errs.some((e) => e.includes('credentials')));
});

test('skill frontmatter problems are caught', () => {
  assert.ok(withCopy((d) => edit(d, 'skills/weekly-recap/SKILL.md', (t) => t.replace(/^---[\s\S]*?---\n/, ''))).some((e) => e.includes('frontmatter')));
  assert.ok(withCopy((d) => edit(d, 'skills/weekly-recap/SKILL.md', (t) => t.replace('name: weekly-recap', 'name: other'))).some((e) => e.includes('must equal folder')));
  assert.ok(withCopy((d) => edit(d, 'skills/weekly-recap/SKILL.md', (t) => t.replace(/Use when /, 'Helps '))).some((e) => e.includes('Use when')));
});

test('every skill must say note content is untrusted', () => {
  const errs = withCopy((d) => edit(d, 'skills/find-open-tasks/SKILL.md', (t) => t.replace(/untrusted/gi, 'careful')));
  assert.ok(errs.some((e) => e.includes('find-open-tasks') && e.includes('untrusted')));
});

test('references to unknown tools and to features we do not build are caught', () => {
  assert.ok(withCopy((d) => edit(d, 'skills/weekly-recap/SKILL.md', (t) => t + '\nUse `delete_note` to clean up.\n')).some((e) => e.includes('unknown tool `delete_note`')));
  assert.ok(withCopy((d) => edit(d, 'skills/weekly-recap/SKILL.md', (t) => t + '\nGroup the notes by folder.\n')).some((e) => e.includes('does not have')));
  // negated mentions are fine
  assert.deepEqual(withCopy((d) => edit(d, 'skills/weekly-recap/SKILL.md', (t) => t + '\nThere are no tags.\n')), []);
});

test('tool list and docs must stay in sync', () => {
  const errs = withCopy((d) => edit(d, 'connector/server.json', (t) => t.replace('"tools": [', '"tools": [ { "name": "new_tool", "scope": "notes:read", "readOnly": true },')));
  assert.ok(errs.some((e) => e.includes('AGENTS.md: tool new_tool')));
  assert.ok(errs.some((e) => e.includes('core skill must document tool new_tool')));
  const errs2 = withCopy((d) => edit(d, 'connector/server.json', (t) => t.replace('"readOnly": false', '"readOnly": true')));
  assert.ok(errs2.some((e) => e.includes('must have readOnly=false')));
});

test('plugin manifest problems are caught', () => {
  assert.ok(withCopy((d) => edit(d, '.claude-plugin/plugin.json', (t) => t.replace('0.1.0', 'one'))).some((e) => e.includes('semver')));
  assert.ok(withCopy((d) => edit(d, '.claude-plugin/marketplace.json', (t) => t.replace('"name": "whatevernote",\n      "source"', '"name": "other",\n      "source"'))).some((e) => e.includes('no plugin entry')));
  assert.ok(withCopy((d) => edit(d, '.claude-plugin/plugin.json', (t) => t.replace('./skills', './nope'))).some((e) => e.includes('does not exist')));
});
