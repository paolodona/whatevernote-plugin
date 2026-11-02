#!/usr/bin/env node
// Consistency checks for the whatevernote plugin. No dependencies (Node 18+).
//   node scripts/validate.mjs [pluginRoot]
// Exits non-zero and prints every problem found.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NEGATION = /\b(no|not|never|nor|cannot|can't|don't|doesn't|without|invent)\b/i;
const BANNED = /\b(tags?|folders?|templates?|due dates?|reminders?)\b/i;
const TOOL_LIKE = /^(whoami|(list|read|search|get|create|append|delete|update|star|restore|edit)_[a-z_]+)$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function readJson(path, errors) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    errors.push(`${path}: ${e.code === 'ENOENT' ? 'missing' : 'invalid JSON'}`);
    return null;
  }
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

export function validate(root) {
  const errors = [];
  const p = (...s) => join(root, ...s);

  // --- connector (source of truth)
  const server = readJson(p('connector', 'server.json'), errors);
  const tools = new Set();
  let url = null;
  if (server) {
    url = server.url;
    if (typeof url !== 'string' || !/^https:\/\/[^/\s]+\/\S*$/.test(url)) errors.push('connector/server.json: url must be an https URL with a path');
    if (server.transport !== 'streamable-http') errors.push('connector/server.json: transport must be streamable-http');
    if (server.auth?.type !== 'oauth2.1') errors.push('connector/server.json: auth.type must be oauth2.1');
    if (!Array.isArray(server.tools) || server.tools.length === 0) errors.push('connector/server.json: tools missing');
    for (const t of server.tools ?? []) {
      if (!t.name) errors.push('connector/server.json: tool without name');
      else tools.add(t.name);
      if (t.scope === 'notes:write' && t.readOnly !== false) errors.push(`connector/server.json: write tool ${t.name} must have readOnly=false`);
      if (t.scope === 'notes:read' && t.readOnly !== true) errors.push(`connector/server.json: read tool ${t.name} must have readOnly=true`);
    }
  }

  // --- Claude adapter agrees
  const mcp = readJson(p('.mcp.json'), errors);
  if (mcp && server) {
    const s = mcp.mcpServers?.whatevernote;
    if (!s) errors.push('.mcp.json: mcpServers.whatevernote missing');
    else {
      if (s.type !== 'http') errors.push('.mcp.json: type must be http');
      if (s.url !== url) errors.push(`.mcp.json: url ${s.url} != connector url ${url}`);
      if (JSON.stringify(s).match(/token|secret|apikey|api_key|authorization/i)) errors.push('.mcp.json: must not contain credentials');
    }
  }
  const plugin = readJson(p('.claude-plugin', 'plugin.json'), errors);
  if (plugin) {
    if (!/^[a-z0-9-]+$/.test(plugin.name ?? '')) errors.push('plugin.json: name must be kebab-case');
    if (!SEMVER.test(plugin.version ?? '')) errors.push('plugin.json: version must be semver');
    if (!plugin.description) errors.push('plugin.json: description missing');
    for (const key of ['skills', 'mcpServers']) {
      const ref = plugin[key];
      if (typeof ref === 'string' && !existsSync(resolve(root, ref))) errors.push(`plugin.json: ${key} path ${ref} does not exist`);
    }
  }
  const market = readJson(p('.claude-plugin', 'marketplace.json'), errors);
  if (market && plugin) {
    const entry = (market.plugins ?? []).find((x) => x.name === plugin.name);
    if (!entry) errors.push(`marketplace.json: no plugin entry named ${plugin.name}`);
    else if (typeof entry.source === 'string' && !existsSync(resolve(root, entry.source))) errors.push(`marketplace.json: source ${entry.source} does not exist`);
  }

  // --- Codex adapter agrees (planned)
  const codex = p('adapters', 'codex', 'config.toml');
  if (existsSync(codex)) {
    const m = /^url\s*=\s*"([^"]+)"/m.exec(readFileSync(codex, 'utf8'));
    if (!m || m[1] !== url) errors.push(`adapters/codex/config.toml: url ${m?.[1]} != connector url ${url}`);
  } else errors.push('adapters/codex/config.toml: missing');

  // --- AGENTS.md
  const agentsPath = p('AGENTS.md');
  if (!existsSync(agentsPath)) errors.push('AGENTS.md: missing');
  else {
    const agents = readFileSync(agentsPath, 'utf8');
    for (const t of tools) if (!agents.includes(`\`${t}\``)) errors.push(`AGENTS.md: tool ${t} not documented`);
    if (!/untrusted/i.test(agents)) errors.push('AGENTS.md: must state that note content is untrusted data');
    checkText('AGENTS.md', agents, tools, errors);
  }

  // --- skills
  const skillsDir = p('skills');
  const skillDirs = existsSync(skillsDir) ? readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory()) : [];
  if (skillDirs.length === 0) errors.push('skills/: no skills found');
  for (const d of skillDirs) {
    const file = join('skills', d, 'SKILL.md');
    if (!existsSync(p(file))) {
      errors.push(`${file}: missing`);
      continue;
    }
    const text = readFileSync(p(file), 'utf8');
    const fm = frontmatter(text);
    if (!fm) {
      errors.push(`${file}: missing YAML frontmatter`);
      continue;
    }
    if (!/^[a-z0-9-]{1,64}$/.test(fm.name ?? '')) errors.push(`${file}: name must be kebab-case, <= 64 chars`);
    if (fm.name !== d) errors.push(`${file}: name "${fm.name}" must equal folder "${d}"`);
    if (!fm.description) errors.push(`${file}: description missing`);
    else {
      if (fm.description.length > 1024) errors.push(`${file}: description too long`);
      if (!/\buse when\b/i.test(fm.description)) errors.push(`${file}: description should say when to use it ("Use when ...")`);
    }
    if (!/untrusted/i.test(text)) errors.push(`${file}: must state that note content is untrusted data`);
    checkText(file, text, tools, errors);
  }
  const core = join('skills', 'whatevernote', 'SKILL.md');
  if (existsSync(p(core))) {
    const t = readFileSync(p(core), 'utf8');
    for (const name of tools) if (!t.includes(`\`${name}\``)) errors.push(`${core}: core skill must document tool ${name}`);
  } else errors.push(`${core}: core skill missing`);

  return errors;
}

function checkText(file, text, tools, errors) {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  lines.forEach((line, i) => {
    if (line.trim().startsWith('```')) inFence = !inFence;
    if (!inFence && BANNED.test(line) && !NEGATION.test(line)) {
      errors.push(`${file}:${i + 1}: mentions a feature whatevernote does not have (tags/folders/templates/due dates/reminders) without negating it`);
    }
    for (const m of line.matchAll(/`([a-z_]+)`/g)) {
      if (TOOL_LIKE.test(m[1]) && !tools.has(m[1])) errors.push(`${file}:${i + 1}: references unknown tool \`${m[1]}\``);
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const errors = validate(root);
  if (errors.length) {
    console.error(`FAILED (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('whatevernote plugin: OK');
}
