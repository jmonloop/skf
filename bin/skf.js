#!/usr/bin/env node
// skf — fuzzy-find an agent "skill" by name OR description.
// Agent-agnostic: scans SKILL.md across Claude Code, Codex, OpenCode, Pi, + custom roots.
// Read-only — never modifies skills, so manual invocation stays intact.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PREFIX = process.env.SKF_PREFIX ?? '/';

// --- roots: dirs to scan, highest priority first (custom > project > global) ---
function searchRoots() {
  const custom = (process.env.SKF_PATHS ?? '').split(':').filter(Boolean);
  const proj = gitRoot();
  const project = ['.claude', '.codex', '.opencode', '.pi', '.skills'].map((d) => join(proj, d));
  const home = homedir();
  const global = ['.claude', '.codex', '.config/opencode', '.opencode', '.pi', '.config/pi'].map((d) => join(home, d));
  return [...custom, ...project, ...global].filter(isDirectory);
}

function gitRoot() {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : process.cwd();
}

// --- collect: every SKILL.md under the roots, newest version first within a root ---
function collectSkillFiles(roots) {
  return roots.flatMap((root) => sortByVersionDesc(walkForSkills(root)));
}

function walkForSkills(dir) {
  return safeReaddir(dir).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return isPrunable(entry.name) ? [] : walkForSkills(full);
    return entry.name === 'SKILL.md' ? [full] : [];
  });
}

// --- parse: SKILL.md frontmatter -> {name, desc, file}; handles folded/literal block scalars ---
function parseSkill(file) {
  return extractFrontmatter(readFileSync(file, 'utf8').split('\n'), file);
}

function extractFrontmatter(lines, file) {
  let inFrontmatter = false, name = '', desc = '', collecting = false;
  for (const line of lines) {
    if (/^---\s*$/.test(line)) { if (inFrontmatter) break; inFrontmatter = true; continue; }
    if (!inFrontmatter) continue;
    const pair = matchKey(line);
    if (pair && pair.key === 'name') { name = unquote(pair.value); collecting = false; }
    else if (pair && pair.key === 'description') ({ desc, collecting } = startDescription(pair.value));
    else if (collecting && /^\s+\S/.test(line)) desc = appendFolded(desc, line);
    else if (pair) collecting = false;
  }
  return name ? { name, desc: desc.replace(/\t/g, ' '), file } : null;
}

function matchKey(line) {
  const m = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
  return m && { key: m[1], value: m[2] };
}

function startDescription(value) {
  const isBlock = /^[>|][+-]?\s*$/.test(value) || value === '';
  return isBlock ? { desc: '', collecting: true } : { desc: unquote(value), collecting: false };
}

function unquote(text) { return text.replace(/^(["'])(.*)\1$/s, '$2'); }

function appendFolded(desc, line) {
  const text = line.trim();
  return desc ? `${desc} ${text}` : text;
}

// --- catalog: roots -> files -> parsed rows, deduped by name (first wins), sorted ---
function buildCatalog() {
  const rows = collectSkillFiles(searchRoots()).map(parseSkill).filter(Boolean);
  return dedupByName(rows).sort((a, b) => a.name.localeCompare(b.name));
}

function dedupByName(rows) {
  const seen = new Set();
  return rows.filter((row) => !seen.has(row.name) && seen.add(row.name));
}

// --- filter: grep title, then grep name+desc, then fuzzy subsequence; first hit wins ---
function filterRows(rows, query) {
  if (!query) return rows;
  const tokens = tokenize(query);
  return firstNonEmpty(
    matchByTitle(rows, tokens),
    matchByContent(rows, tokens),
    matchBySubsequence(rows, tokens),
  );
}

function tokenize(query) { return query.toLowerCase().split(/\s+/).filter(Boolean); }
function firstNonEmpty(...tiers) { return tiers.find((tier) => tier.length) ?? []; }

function matchByTitle(rows, tokens) {
  return rows
    .filter((row) => tokens.every((token) => row.name.toLowerCase().includes(token)))
    .sort((a, b) => titleRank(a.name, tokens[0]) - titleRank(b.name, tokens[0])
      || a.name.length - b.name.length || a.name.localeCompare(b.name));
}

function titleRank(name, firstToken) {
  return name.toLowerCase().startsWith(firstToken) ? 0 : 1;
}

function matchByContent(rows, tokens) {
  return rows
    .filter((row) => tokens.every((token) => haystack(row).includes(token)))
    .sort((a, b) => nameHits(b, tokens) - nameHits(a, tokens) || a.name.localeCompare(b.name));
}

function matchBySubsequence(rows, tokens) {
  return rows
    .filter((row) => tokens.every((token) => isSubsequence(token, haystack(row))))
    .sort((a, b) => nameHits(b, tokens) - nameHits(a, tokens) || a.name.localeCompare(b.name));
}

function isSubsequence(needle, hay) {
  let i = 0;
  for (const ch of hay) if (ch === needle[i] && ++i === needle.length) return true;
  return i === needle.length;
}

function haystack(row) { return `${row.name} ${row.desc}`.toLowerCase(); }

function nameHits(row, tokens) {
  const name = row.name.toLowerCase();
  return tokens.filter((token) => name.includes(token)).length;
}

// --- interactive: pipe catalog to fzf, return the chosen skill name ---
function pickWithFzf(catalog, query) {
  const input = catalog.map((row) => `${row.name}\t${row.desc}\t${row.file}`).join('\n');
  const res = spawnSync('fzf', fzfArgs(query), { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
  if (res.status !== 0) process.exit(res.status === 130 ? 130 : 1);
  return res.stdout.split('\t')[0].trim();
}

function fzfArgs(query) {
  return ['--delimiter=\t', '--with-nth=1,2', '--nth=1,2', `--query=${query || ''}`,
    '--prompt=skill> ', '--height=80%', '--layout=reverse', '--border',
    '--preview=sed -n "1,60p" {3}', '--preview-window=right:55%:wrap'];
}

// --- output: print "<prefix><name>" and copy it to the clipboard ---
function emitSelection(name) {
  if (!name) process.exit(1);
  const token = `${PREFIX}${name}`;
  console.log(token);
  if (copyToClipboard(token)) console.error('(copied to clipboard)');
}

const CLIPBOARD_COMMANDS = [
  ['pbcopy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']],
  ['wl-copy', []], ['clip.exe', []],
];

function copyToClipboard(text) {
  return CLIPBOARD_COMMANDS.some(([cmd, args]) => {
    const res = spawnSync(cmd, args, { input: text });
    return !res.error && res.status === 0;
  });
}

function printMatches(query) {
  for (const row of filterRows(buildCatalog(), query).slice(0, 15)) {
    console.log(`${PREFIX}${row.name}  — ${row.desc.slice(0, 70)}`);
  }
}

function interactivePick(query) {
  if (!commandExists('fzf')) fail("fzf not found — install it or use 'skf -p <term>'");
  emitSelection(pickWithFzf(grepPool(buildCatalog(), query), query));
}

// grep name+desc first; hand only those to fzf. No grep hit -> full catalog for fuzzy.
function grepPool(catalog, query) {
  if (!query) return catalog;
  const hits = matchByContent(catalog, tokenize(query));
  return hits.length ? hits : catalog;
}

function main(argv) {
  const [first, ...rest] = argv;
  if (first === '-h' || first === '--help') return usage();
  if (first === '-p') return printMatches(rest.join(' '));
  return interactivePick(first ?? '');
}

// --- small utilities ---
function isDirectory(path) { try { return statSync(path).isDirectory(); } catch { return false; } }
function safeReaddir(dir) { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } }
function isPrunable(name) { return name === 'node_modules' || name === '.git' || name === '.tmp'; }
function sortByVersionDesc(files) { return files.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); }
function commandExists(cmd) { return !spawnSync(cmd, ['--version']).error; }
function fail(message) { console.error(`skf: ${message}`); process.exit(1); }

function usage() {
  console.log(`skf — fuzzy-find an agent skill by name OR description.

Usage:
  skf                interactive fzf picker (ENTER copies <prefix><name>)
  skf <term>         picker pre-seeded with <term>
  skf -p [<term>]    print mode (no UI); TUI-safe via \`! skf -p ...\`
  skf -h             this help

Config:
  SKF_PATHS    colon-separated extra roots to scan (highest priority)
  SKF_PREFIX   invocation prefix to print/copy (default "/")`);
}

main(process.argv.slice(2));
