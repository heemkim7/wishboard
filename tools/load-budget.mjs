// What a fresh visit downloads, per phase, resolved statically from the files on disk.
//   boot   before the player taps 입장하기: index.html and what it links, the module graph from its <script type=module>,
//          and every asset the boot path asks for (city, env photos, own species model, HUD images)
//   first  the first minute after entering: other species once their avatars are on screen or in the idle prefetch, counted
//          as the PREFETCH_MAX largest other models on disk (the prefetch asks for at most that many), audio
//   later  only when a sheet opens (plot pictures, hub picture, photo credits, the character picker's thumbnails), the
//          remaining species models, which load only when an avatar of that species walks into view, and the five plot
//          buildings, which load when the player first comes near the lots' street
// Every '/assets/…' or 'icons/…' literal in a loaded module must match a RULE below, so a new download cannot slip into
// the boot path unnoticed (test/load.test.mjs). Wire bytes are gzip -9 for text and raw for images, models and the
// already-gzipped manhattan.bin; Cloudflare's brotli is a little smaller. CDN files (supabase-js, fonts) are listed
// under `external` and not counted, nor are approved billboard photos (decided by world data at run time); together they
// add a few hundred KB on a fresh phone.
//   node tools/load-budget.mjs [--quality low|medium|high] [--species 1..10] [--json]   (phones run the low tier)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MODEL_URL, ENV_PHOTOS, envPhotoUrl, PREFETCH_MAX } from '../ts3d/loadplan.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUDGET = { boot: 5_000_000, first: 7_000_000 };

const TEXT = /\.(js|mjs|html|css|json|webmanifest|svg)$/;
const posix = (p) => p.split(path.sep).join('/');
const clean = (u) => u.replace(/^\.?\//, '').replace(/[?#].*$/, '');

// [pattern on the literal (no leading slash, no query), phase or (literal, ctx) => phase, files the literal stands for]
export const RULES = [
  [/^assets\/nyc\/manhattan\.bin$/, 'boot'],
  // (No rule for ground or facade photo textures: the ground and the walls are procedural and those files are gone,
  // so a literal that asks for one again shows up as unclassified.)
  [/^icons\/bokjumeoni\.png$/, 'boot'], // the pouch balloon floats over the plaza from the first frame
  [/^icons\/coin\.jpg$/, 'boot'], // wallet icon, built with the HUD
  [/^assets\/times-square\/\$\{name\}\.env\.jpg$/, 'boot', () => ENV_PHOTOS.map((n) => clean(envPhotoUrl(n)))],
  [/^assets\/models\/[A-Z][a-z]+Toy\.glb$/, (lit, ctx) => (lit === clean(MODEL_URL[ctx.species]) ? 'boot' : ctx.peers.has(lit) ? 'first' : 'later')],
  // The five plot buildings (ts3d/loadplan.js LOT_MODEL_URL): never at boot. They are asked for together the first time the
  // camera or the player is within LOTS_R of the lots' street (234 m from the spawn), like a species model on first sight.
  // A link that lands on a plot does fetch them in its first minute: 0.6 MB that the `first` total does not count.
  [/^assets\/models\/lots\/lot[0-4]_[a-z]+\.glb$/, 'later'],
  [/^assets\/avatars\/[a-z]+(-hood)?\.png$/, 'later'], // character picker tiles and their hoodie masks (ts3d/avatars.js SPECIES thumb, hood), only in the profile sheet
  [/^assets\/audio\/(sfx\/)?$/, 'first', () => []], // 'assets/audio/' + id + '.ogg': no such files in the repo, the browser gets 404s
  // The cab and car model (loadplan.js TAXI_URL): nothing waits for it. ts3d/traffic.js asks for it only after the street
  // has been drawn with the box cars, which stay if it never comes, so it is counted with the first minute, not with boot.
  [/^assets\/models\/taxi\.glb$/, 'first'],
  [/^icons\/(lot|tent|pocha|shop|tower)\.jpg$/, 'later'],
  [/^icons\/board\.jpg$/, 'later'],
  [/^assets\/times-square\/credits\.json$/, 'later'],
];

function importMap(html) {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]).imports : {};
}
function resolveSpec(spec, from, map) {
  if (/^https?:/.test(spec)) return { external: spec };
  if (spec.startsWith('.') || spec.startsWith('/')) return { file: posix(path.posix.normalize(spec.startsWith('/') ? spec.slice(1) : path.posix.join(path.posix.dirname(from), clean(spec.replace(/^\.\//, './'))))).replace(/[?#].*$/, '') };
  let best = '';
  for (const k of Object.keys(map)) if ((spec === k || (k.endsWith('/') && spec.startsWith(k))) && k.length > best.length) best = k;
  if (!best) return { external: spec };
  const to = map[best] + spec.slice(best.length);
  return /^https?:/.test(to) ? { external: to } : { file: clean(to) };
}
const IMPORT_RE = /\b(?:import|export)\s*(?:[\w*${}\s,]+?\s*from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const ASSET_RE = /['"`]\/?((?:assets|icons)\/[^'"`]*?)(?:\?[^'"`]*)?['"`]/g;
const TPL_RE = /`\/?((?:assets|icons)\/[^`]*)`/g;

// The other species' models the first minute counts: the `n` largest on disk (missing files weigh nothing and come last).
export function firstPeers(root, species, n = PREFETCH_MAX) {
  const size = (u) => { try { return fs.statSync(path.join(root, clean(u))).size; } catch { return -1; } };
  return new Set(Object.entries(MODEL_URL).filter(([id]) => Number(id) !== species).map(([, u]) => [clean(u), size(u)])
    .filter(([, b]) => b >= 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([u]) => u));
}

export function loadBudget({ root = ROOT, species = 1, quality = 'low' } = {}) {
  const peers = firstPeers(root, species);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const map = importMap(html);
  const items = new Map(); // file -> { file, phase, why }
  const external = new Set(), unclassified = [], missing = [];
  const add = (file, phase, why) => {
    const f = clean(file);
    const prev = items.get(f);
    const rank = { boot: 0, first: 1, later: 2 };
    if (!prev || rank[phase] < rank[prev.phase]) items.set(f, { file: f, phase, why });
  };
  add('index.html', 'boot', 'page');
  for (const m of html.matchAll(/<link\b[^>]*rel="(?:icon|apple-touch-icon|manifest|stylesheet|modulepreload)"[^>]*href="([^"]+)"/g)) (/^https?:/.test(m[1]) ? external.add(m[1]) : add(m[1], 'boot', 'index.html <link>'));
  for (const m of html.matchAll(/<img\b[^>]*src="([^"]+)"/g)) add(m[1], 'boot', 'index.html <img>');
  for (const m of html.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) if (!m[1].startsWith('data:')) add(m[1], 'boot', 'index.html CSS');
  const mods = [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => clean(m[1]));
  const seen = new Set();
  const todo = [...mods];
  while (todo.length) {
    const file = todo.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    add(file, 'boot', 'module graph');
    const full = path.join(root, file);
    if (!fs.existsSync(full)) { missing.push(file); continue; }
    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const r = resolveSpec(m[1] || m[2], file, map);
      if (r.external) external.add(r.external);
      else todo.push(r.file);
    }
    if (file.startsWith('vendor/')) continue;
    const lits = new Set();
    for (const m of src.matchAll(TPL_RE)) lits.add(m[1].replace(/\?[^}]*$/, '')); // a trailing query, not a ternary inside ${}
    for (const m of src.matchAll(ASSET_RE)) if (!m[1].includes('${') && !m[0].startsWith('`')) lits.add(m[1]);
    for (const lit of lits) {
      const rule = RULES.find(([re]) => re.test(lit));
      if (!rule) { unclassified.push(file + ': ' + lit); continue; }
      const phase = typeof rule[1] === 'function' ? rule[1](lit, { species, quality, peers }) : rule[1];
      const files = rule[2] ? rule[2](root, { species, quality }) : [lit];
      for (const f of files) add(f, phase, file);
    }
  }
  const rows = [];
  for (const it of items.values()) {
    const full = path.join(root, it.file);
    if (!fs.existsSync(full)) { missing.push(it.file); continue; }
    const raw = fs.statSync(full).size;
    const wire = TEXT.test(it.file) ? zlib.gzipSync(fs.readFileSync(full), { level: 9 }).length : raw;
    rows.push({ ...it, raw, wire });
  }
  rows.sort((a, b) => a.phase.localeCompare(b.phase) || b.wire - a.wire);
  const sum = (ph, k) => rows.filter((r) => ph.includes(r.phase)).reduce((a, r) => a + r[k], 0);
  const totals = {
    boot: { raw: sum(['boot'], 'raw'), wire: sum(['boot'], 'wire') },
    first: { raw: sum(['boot', 'first'], 'raw'), wire: sum(['boot', 'first'], 'wire') },
    everything: { raw: sum(['boot', 'first', 'later'], 'raw'), wire: sum(['boot', 'first', 'later'], 'wire') },
  };
  return { rows, totals, external: [...external].sort(), unclassified, missing: [...new Set(missing)].sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const r = loadBudget({ species: Number(arg('--species', 1)), quality: arg('--quality', 'low') });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  const kb = (n) => (n / 1024).toFixed(0).padStart(6) + ' KB';
  const group = (k) => r.rows.filter((x) => x.phase === k);
  for (const ph of ['boot', 'first', 'later']) {
    console.log(`\n== ${ph}`);
    const rows = group(ph);
    const big = rows.filter((x) => x.wire >= 20000);
    for (const x of big) console.log(kb(x.wire), kb(x.raw), ' ', x.file);
    const small = rows.filter((x) => x.wire < 20000);
    if (small.length) console.log(kb(small.reduce((a, x) => a + x.wire, 0)), kb(small.reduce((a, x) => a + x.raw, 0)), ' ', small.length, 'smaller files');
  }
  const mb = (n) => (n / 1e6).toFixed(2) + ' MB';
  console.log('\nExcludes CDN downloads (supabase-js, the Pretendard and Black Han Sans font files) and approved billboard photos,');
  console.log('which add a few hundred KB on a fresh phone.');
  console.log('           wire      raw');
  for (const [k, v] of Object.entries(r.totals)) console.log(k.padEnd(11), mb(v.wire).padStart(8), mb(v.raw).padStart(9));
  console.log('\nbudget: boot', mb(BUDGET.boot), '· first minute', mb(BUDGET.first));
  console.log('external (not counted):', r.external.join(', '));
  if (r.missing.length) console.log('referenced but not on disk:', r.missing.join(', '));
  if (r.unclassified.length) { console.log('UNCLASSIFIED asset literals:\n  ' + r.unclassified.join('\n  ')); process.exitCode = 1; }
}
