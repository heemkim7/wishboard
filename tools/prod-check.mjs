// Read-only checks against the deployed site. Run from the repo root:
//   node tools/prod-check.mjs https://studio.wishboard.workers.dev
// Prints statuses, sizes and key names only; never response bodies of secret-looking paths. Exit 1 when something is off.
// The write half (test guests, wish, board) is tools/prod-e2e.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// .assetsignore uses .gitignore syntax (wrangler). Rules: { neg, dir, anchored, re }.
export function parseIgnore(text) {
  const rules = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let p = raw.replace(/\s+$/, ''); if (!p || p.startsWith('#')) continue;
    const neg = p.startsWith('!'); if (neg) p = p.slice(1);
    const dir = p.endsWith('/'); if (dir) p = p.replace(/\/+$/, '');
    const anchored = p.includes('/'); p = p.replace(/^\//, '');
    let re = '';
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (ch === '*' && p[i + 1] === '*') { if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; } }
      else if (ch === '*') re += '[^/]*';
      else if (ch === '?') re += '[^/]';
      else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    rules.push({ neg, dir, anchored, re: new RegExp((anchored ? '^' : '(?:^|/)') + re + '$') });
  }
  return rules;
}
// true when the repo-relative path (forward slashes) is not uploaded: a matching rule on the file or on any parent directory, last rule wins.
// dir: the path itself is a directory (dir-only rules such as `out/` apply to it).
export function ignoredBy(rules, rel, dir = false) {
  const parts = String(rel).split('/').filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join('/'), isDir = i < parts.length || dir; let hit = false;
    for (const r of rules) if ((!r.dir || isDir) && r.re.test(sub)) hit = !r.neg;
    if (hit) return true;
  }
  return false;
}
// wrangler never uploads its own ignore file
export const ALWAYS_SKIP = new Set(['.assetsignore']);

// The search and install files the site must serve: robots.txt (the API and admin closed, the sitemap named), sitemap.xml (the home page), the web
// app manifest (a 192 and a 512 icon, one maskable). '' when the answer is fine, else what is wrong. type: the content-type header, body: text.
export function seoFault(name, status, type, body) {
  const t = String(type || ''), b = String(body || '');
  if (status !== 200) return `status ${status}`;
  if (name === 'robots') {
    if (!/text\/plain/i.test(t)) return 'not text/plain';
    if (!/^Disallow:\s*\/rt\/\s*$/m.test(b) || !/^Disallow:\s*\/admin\s*$/m.test(b)) return 'does not close /rt/ and /admin';
    return /^Sitemap:\s*https:\/\/\S+\/sitemap\.xml\s*$/m.test(b) ? '' : 'no Sitemap line';
  }
  if (name === 'sitemap') return /xml/i.test(t) && /<urlset[\s>]/.test(b) && /<loc>https:\/\/[^<]+\/<\/loc>/.test(b) ? '' : 'not a sitemap with the home page';
  if (name === 'manifest') {
    let m = null; try { m = JSON.parse(b); } catch { return 'not JSON'; }
    const icons = Array.isArray(m?.icons) ? m.icons : [];
    const has = (size, purpose) => icons.some((i) => i.sizes === size && i.type === 'image/png' && String(i.purpose || 'any').split(/\s+/).includes(purpose));
    return m.start_url && m.display === 'standalone' && has('192x192', 'any') && has('512x512', 'any') && has('512x512', 'maskable') ? '' : 'start_url, display or icons are off';
  }
  return 'unknown check';
}

async function main() {
  const ORIGIN = String(process.argv[2] || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(ORIGIN)) { console.error('usage: node tools/prod-check.mjs https://host'); process.exit(64); }
  let bad = 0;
  const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
  const get = async (p, init) => {
    const r = await fetch(ORIGIN + p, { redirect: 'manual', ...init });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type') || '', cc: r.headers.get('cache-control') || '', buf, loc: r.headers.get('location') || '' };
  };

  // 1. every served file is byte-identical to the working tree; what .assetsignore drops is not compared
  const rules = parseIgnore(fs.readFileSync('.assetsignore', 'utf8'));
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d || '.', { withFileTypes: true })) {
      const p = d ? d + '/' + e.name : e.name;
      if (ALWAYS_SKIP.has(p) || ignoredBy(rules, p, e.isDirectory())) continue;
      if (e.isDirectory()) { walk(p); continue; }
      files.push(p);
    }
  })('');
  let same = 0; const diff = [];
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(files.slice(i, i + 8).map(async (f) => {
      let r = await get('/' + f.split('/').map(encodeURIComponent).join('/'));
      // html_handling serves x.html at /x (and index.html at /) and answers the .html path with a redirect to it.
      if (r.status >= 300 && r.status < 400 && r.loc && f.endsWith('.html')) { const to = new URL(r.loc, ORIGIN); if (to.origin === new URL(ORIGIN).origin) r = await get(to.pathname); }
      const local = fs.readFileSync(f);
      if (r.status === 200 && sha(r.buf) === sha(local)) same++;
      else diff.push(`${f} status=${r.status} live=${r.buf.length}B local=${local.length}B`);
    }));
  }
  console.log(`[files] ${same}/${files.length} served files identical to the working tree`);
  diff.forEach((d) => console.log('   DIFF', d)); bad += diff.length;
  console.log('[git]   HEAD', execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(), 'tracked changes:', execSync('git status --porcelain --untracked-files=no', { encoding: 'utf8' }).trim() || 'none');

  // 2. things that must not be served
  for (const p of ['/.dev.vars', '/.env', '/.git/HEAD', '/.wrangler/', '/.claude/launch.json', '/.assetsignore', '/worker.js', '/schema.sql', '/wrangler.jsonc', '/MORNING_REPORT.md', '/AGENTS.md', '/IMPLEMENTED.md', '/tools/stamp.mjs', '/tools/prod-e2e.mjs', '/test/wish.test.mjs']) {
    const r = await get(p);
    if (r.status === 200) bad++;
    console.log(`[hidden] ${p.padEnd(24)} -> ${r.status} (${r.buf.length}B)${r.status === 200 ? '  <-- SERVED' : ''}`);
  }

  // 3. module graph from index.html: every import resolves, one URL per module
  const index = (await get('/')).buf.toString('utf8');
  const build = (index.match(/main\.js\?v=(\d+)/) || [])[1];
  console.log('[index] build id in index.html:', build);
  const seen = new Map(); const queue = ['/main.js?v=' + build]; const fails = [];
  const IMP = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\s]+)\1/g;
  while (queue.length) {
    const u = queue.shift(); if (seen.has(u)) continue;
    const r = await get(u); seen.set(u, r.status);
    if (r.status !== 200 || !/javascript/.test(r.type)) { fails.push(`${u} ${r.status} ${r.type}`); continue; }
    if (u.startsWith('/vendor/')) continue;
    const src = r.buf.toString('utf8'); let m;
    while ((m = IMP.exec(src))) { const n = new URL(m[2], ORIGIN + u); if (n.origin === ORIGIN) queue.push(n.pathname + n.search); }
  }
  const byPath = new Map(); for (const u of seen.keys()) { const p = u.split('?')[0]; byPath.set(p, (byPath.get(p) || new Set()).add(u)); }
  const dup = [...byPath].filter(([, s]) => s.size > 1).map(([p, s]) => `${p} x${s.size}`);
  console.log(`[modules] ${seen.size} module URLs reached, failures: ${fails.length}, modules under more than one URL: ${dup.length}`);
  fails.forEach((b) => console.log('   BAD', b)); dup.forEach((d) => console.log('   DUP', d)); bad += fails.length + dup.length;

  // 4. API, read-only
  const j = async (p) => { const r = await get(p); let body = null; try { body = JSON.parse(r.buf.toString('utf8')); } catch {} return { r, body }; };
  const shape = (o) => (o && typeof o === 'object' ? (Array.isArray(o) ? `array(${o.length})` : '{' + Object.keys(o).join(',') + '}') : String(o));
  for (const p of ['/rt/config', '/rt/world', '/rt/wishes', '/rt/health', '/rt/gate', '/rt/push/key']) {
    const { r, body } = await j(p);
    if (r.status !== 200) bad++;
    console.log(`[api] GET ${p.padEnd(12)} -> ${r.status} ${shape(body)}`);
    if (p === '/rt/wishes' && body) for (const k of Object.keys(body)) console.log(`        ${k}: ${shape(body[k])}`);
  }
  for (const p of ['/rt/wishes?id=nope', '/rt/w/nope', '/rt/s/' + '0'.repeat(32), '/rt/admin/wishes']) {
    const r = await get(p);
    console.log(`[api] GET ${p.padEnd(40)} -> ${r.status} ${r.type.split(';')[0]} ${r.loc ? '-> ' + r.loc : ''}`);
  }
  for (const [p, init] of [['/rt/wish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }], ['/rt/wish/heart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }]]) {
    const r = await get(p, init); let e = ''; try { e = JSON.stringify(JSON.parse(r.buf.toString('utf8'))).slice(0, 80); } catch {}
    console.log(`[api] POST ${p.padEnd(16)} without a token -> ${r.status} ${e}`);
  }
  const swr = await get('/sw.js'); console.log(`[sw]  /sw.js -> ${swr.status} ${swr.type.split(';')[0]} cache-control: ${swr.cc}`);
  // The Google sign-in window comes back to /oauth?code=…: it must be oauth.html itself, not a redirect (which could lose the code).
  if (fs.existsSync('oauth.html')) {
    const oa = await get('/oauth?code=probe'); const okOa = oa.status === 200 && /html/.test(oa.type) && sha(oa.buf) === sha(fs.readFileSync('oauth.html'));
    if (!okOa) bad++;
    console.log(`[oauth] /oauth?code=probe -> ${oa.status} ${oa.type.split(';')[0]} ${oa.loc ? '-> ' + oa.loc : ''}${okOa ? '' : '  <-- not oauth.html'}`);
  }
  // Search and install files (the byte comparison above already covers that they match the tree; this says they say the right things).
  for (const [name, p] of [['robots', '/robots.txt'], ['sitemap', '/sitemap.xml'], ['manifest', '/manifest.webmanifest']]) {
    const r = await get(p); const fault = seoFault(name, r.status, r.type, r.buf.toString('utf8'));
    if (fault) bad++;
    console.log(`[seo] ${p.padEnd(22)} -> ${r.status} ${r.type.split(';')[0]}${fault ? '  <-- ' + fault : ''}`);
  }
  // The advertising page (상6) is linked as /ads from the house ad on the ad screens: ads.html itself, and its stats endpoint answers.
  if (fs.existsSync('ads.html')) {
    const ad = await get('/ads'); const okAd = ad.status === 200 && /html/.test(ad.type) && sha(ad.buf) === sha(fs.readFileSync('ads.html'));
    const st = await get('/rt/ads/stats'); let on = null; try { on = JSON.parse(st.buf.toString('utf8')).on; } catch { on = null; }
    if (!okAd || st.status !== 200 || typeof on !== 'boolean') bad++;
    console.log(`[ads]  /ads -> ${ad.status} ${ad.type.split(';')[0]}${okAd ? '' : '  <-- not ads.html'} · /rt/ads/stats -> ${st.status} on=${on}`);
  }
  console.log(bad ? `\n${bad} problem(s)` : '\nno problems');
  process.exit(bad ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
