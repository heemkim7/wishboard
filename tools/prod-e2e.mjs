// End-to-end check of a deployed plaza with three test guests. Run from the repo root:
//   node tools/prod-e2e.mjs https://studio.wishboard.workers.dev [--only=wish,board] [--keep] [--fresh] [--state=<file>]
// It writes to the live service (guests, wallets, one wish, two photos, one board). IMPLEMENTED.md (실서비스 점검 도구) says what it leaves behind.
// ADMIN_KEY comes from ./.dev.vars. Secrets and guest tokens are never printed; ids show their last 4 characters only.
// The tokens live in the state file under os.tmpdir() so a later run reuses the same guests instead of minting more.
// Node 22+ built-ins only (global fetch and WebSocket).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALANCE, PAY, SLOTS, floorOf } from '../balance.js';
import { WISH, cleanWish } from '../wish.js';

export const TOPIC = 'chapel:square', ROOM = 'square'; // what net.js opens for the first shard
export const NICKS = Object.freeze(['점검1', '점검2', '점검3']);
export const WISH_TEXT = '소원 점검 중이에요 🌠';
export const WISH_EDIT = '소원 점검 고쳐 쓰기 🌠';
export const WISH_LINK = '점검 www.example.com 들러 주세요';
export const WISH_PHONE = '점검 010-1234-5678 연락 주세요';
export const BOARD_LINES = Object.freeze(['점검 중', '곧 내려갑니다', '']);
export const SITE_TITLE = 'WISH BOARD : 모두의 전광판'; // worker.js SITE.title, the page for a photo without context
export const TAKEDOWN_LINE = '운영자가 내렸습니다'; // schema.sql takedown_billboard
export const NEUTRAL_LINES = Object.freeze(['여기도 소원 자리예요', '불이 꺼지면', '누구나 걸 수 있어요']); // what cleanup edits the test board to (holder edit, no bid change)
export const CLEANUP_WINDOW_MS = 30 * 60000; // C-tier protection after a claim: inside it nobody else can have taken the board
const GRANT_BELOW = 1000; // the operator grant only tops up a wallet under this
export const STEP_NAMES = Object.freeze(['admin', 'guests', 'enter', 'coins', 'wish', 'share', 'push', 'board', 'moderation', 'cleanup']);
const NEEDS = { admin: [], guests: ['admin'], enter: ['guests'], coins: ['enter'], wish: ['guests'], share: ['wish'], push: [], board: ['enter', 'coins'], moderation: ['wish'], cleanup: [] };
const WISH_ID = /^[0-9a-z]{10}$/, SNAP_ID = /^[0-9a-f]{32}$/, SUB_RE = /^g-[0-9a-f-]{36}$/;
const GRANT = 3000;

// ---------- pure helpers (test/prodcheck.test.mjs) ----------
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// '' when ok: https, or http only for a local host; no path, query or hash
export function originFault(origin) {
  let u; try { u = new URL(origin); } catch { return 'the origin must look like https://host'; }
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return 'the origin must look like https://host (no path)';
  if (u.protocol === 'https:') return '';
  if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return '';
  return 'the origin must be https:// (http:// only for localhost, 127.0.0.1, [::1])';
}
// The state file holds live guest tokens, so it must sit under the temp directory, never in the working tree.
export function stateFault(file, tmp = os.tmpdir()) {
  const norm = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const rel = path.relative(norm(tmp), norm(file));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? '' : `the state file must be under ${tmp} (it holds live guest tokens)`;
}
export function parseArgs(argv, tmp = os.tmpdir()) {
  const out = { origin: '', only: null, keep: false, fresh: false, state: '', help: false, errors: [] };
  for (const a of argv) {
    if (a === '--keep') out.keep = true;
    else if (a === '--fresh') out.fresh = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (a.startsWith('--only=')) { const names = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean), bad = names.filter((n) => !STEP_NAMES.includes(n));
      if (bad.length || !names.length) out.errors.push('unknown step in --only: ' + (bad.join(', ') || '(empty)')); out.only = new Set(names); }
    else if (a.startsWith('--state=') && a.length > 8) out.state = a.slice(8);
    else if (a.startsWith('-')) out.errors.push('unknown option: ' + a);
    else if (!out.origin) out.origin = a;
    else out.errors.push('extra argument: ' + a);
  }
  if (!out.help) {
    if (!out.origin) out.errors.push('the origin is required, e.g. https://studio.wishboard.workers.dev');
    else { const f = originFault(out.origin); if (f) out.errors.push(f); else out.origin = new URL(out.origin).origin; }
    if (out.state) { out.state = path.resolve(out.state); const f = stateFault(out.state, tmp); if (f) out.errors.push(f); }
  }
  return out;
}
// The steps to run for --only: the named ones, what they need, and always admin (the key check) and cleanup.
export function planSteps(only) {
  if (!only) return STEP_NAMES.slice();
  const want = new Set(['admin', 'cleanup']), add = (n) => { if (want.has(n)) return; want.add(n); for (const d of NEEDS[n] || []) add(d); };
  for (const n of only) add(n);
  return STEP_NAMES.filter((n) => want.has(n));
}
export function parseDevVars(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line); if (!m) continue;
    let v = m[2].trim(); if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
export const mask = (s) => (s ? '…' + String(s).slice(-4) : '-');
// Response text for a log line: guest tokens, tickets, guest subs and the given secrets never come through.
export function sanitize(text, secrets = []) {
  let s = String(text ?? '');
  for (const k of secrets) if (k && String(k).length >= 6) s = s.split(String(k)).join('<secret>');
  return s.replace(/g1\.[\w-]+\.[\w-]+/g, 'g1.<token>').replace(/h1\.[\w-]+\.[\w-]+/g, 'h1.<ticket>')
    .replace(/g-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => 'g-…' + m.slice(-4));
}
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
// content of <meta property|name="key" content="..."> (HTML-unescaped), or null
export function metaContent(html, key) {
  const re = /<meta\s+([^>]*?)\/?>/gi; let m;
  while ((m = re.exec(String(html || '')))) {
    const at = {}; for (const a of m[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) at[a[1].toLowerCase()] = a[2];
    if (at.property === key || at.name === key) return unesc(at.content ?? '');
  }
  return null;
}
export const pathOf = (u, origin) => { try { const x = new URL(String(u), origin); return x.pathname + x.search; } catch { return ''; } };
// Empty boards the run may claim, cheapest first: not a main-tower slot (S tier goes to review and opens 21:00 KST only), not a free starter slot,
// no holder at all (a dark board still belongs to a player), and not a plot front whose plot has an owner (half the bid would go to that player).
export function slotCandidates(world, starter = BALANCE.starterSlots) {
  const owned = new Set((Array.isArray(world?.plots) ? world.plots : []).filter((p) => p && p.owner_id).map((p) => Number(p.plot_id)));
  const rows = new Map((Array.isArray(world?.billboards) ? world.billboards : []).map((b) => [String(b?.slot_id), b]));
  const out = [];
  SLOTS.forEach((s, order) => {
    const b = rows.get(s.id);
    if (!b || s.id.startsWith('MAIN_') || starter.includes(s.id) || b.holder_id) return;
    if (b.plot_id != null && owned.has(Number(b.plot_id))) return;
    out.push({ slot: s.id, bid: floorOf(s.id), order });
  });
  return out.sort((a, b) => a.bid - b.bid || a.order - b.order);
}
// The free-first slots to stay off: BALANCE.starterSlots plus every slot GET /rt/config lists in `starter` (the database's list may differ).
export function starterOf(config) {
  const out = [...BALANCE.starterSlots];
  for (const id of Array.isArray(config?.starter) ? config.starter : []) if (typeof id === 'string' && !out.includes(id)) out.push(id);
  return out;
}
export const kstDay = (t = Date.now()) => new Date(t + 9 * 36e5).toISOString().slice(0, 10);
export const kstMinutesToMidnight = (t = Date.now()) => { const d = new Date(t + 9 * 36e5); return 1440 - (d.getUTCHours() * 60 + d.getUTCMinutes()); };
export function defaultStatePath(origin, dir = os.tmpdir()) { return path.join(dir, 'kts-prod-e2e-' + new URL(origin).host.replace(/[^\w.-]/g, '_') + '.json'); }
export function summaryTable(rows) {
  const by = new Map();
  for (const r of rows) { const s = by.get(r.step) || { PASS: 0, FAIL: 0, SKIP: 0 }; s[r.status] = (s[r.status] || 0) + 1; by.set(r.step, s); }
  const tot = { PASS: 0, FAIL: 0, SKIP: 0 }, lines = ['step         pass  fail  skip'];
  for (const [step, s] of by) { lines.push(step.padEnd(12) + String(s.PASS).padStart(5) + String(s.FAIL).padStart(6) + String(s.SKIP).padStart(6)); for (const k in tot) tot[k] += s[k]; }
  lines.push('total'.padEnd(12) + String(tot.PASS).padStart(5) + String(tot.FAIL).padStart(6) + String(tot.SKIP).padStart(6));
  return { text: lines.join('\n'), ...tot };
}

// ---------- client ----------
class StepStop extends Error {}
class KeyRefused extends Error {} // stop the whole run before anything is created (exit 2)
function emptyState(origin) { return { v: 1, origin, guests: [], retired: [], hello: {}, wishes: [], slots: [], snaps: [] }; }
// A missing file is a fresh start. An unreadable, corrupt or foreign one stops the run: it may list boards and wishes that still need cleanup.
function loadState(file, origin) {
  let raw = null; try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return emptyState(origin); throw new StepStop(`cannot read the state file ${file}: ${e?.code || e?.message}`); }
  let j = null; try { j = JSON.parse(raw); } catch { j = null; }
  if (!j || typeof j !== 'object' || j.v !== 1) throw new StepStop(`the state file ${file} is corrupt or from another version; it may list test boards and wishes still to clean up. Fix or move it by hand, then run again`);
  if (j.origin !== origin) throw new StepStop(`the state file ${file} belongs to ${j.origin}; pass --state=<another file>`);
  for (const k of ['guests', 'retired', 'wishes', 'slots', 'snaps']) if (!Array.isArray(j[k])) j[k] = [];
  if (!j.hello || typeof j.hello !== 'object') j.hello = {};
  for (const s of j.slots) if (!s.status) s.status = s.down ? 'down' : 'held'; // held | neutral | down
  return j;
}
function makeApi(c) {
  return async function api(guest, method, p, body, o = {}) {
    const headers = { ...(o.headers || {}) };
    if (guest?.token) headers.authorization = 'Bearer ' + guest.token;
    if (o.admin) headers['x-admin-key'] = c.adminKey;
    let payload;
    if (body instanceof Uint8Array) { payload = body; headers['content-type'] = 'image/jpeg'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const shown = p.split('?')[0].length > 80 ? p.slice(0, 80) + '…' : p, res = { ok: false, status: 0, method, path: shown, text: '', json: null, bytes: new Uint8Array(0), type: '', location: '', headers: new Headers() };
    try {
      const r = await c.fetch(c.origin + p, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(Math.max(5000, c.ms(20000))) });
      res.status = r.status; res.ok = r.status >= 200 && r.status < 300; res.headers = r.headers; res.type = r.headers.get('content-type') || ''; res.location = r.headers.get('location') || '';
      res.bytes = new Uint8Array(await r.arrayBuffer());
      if (!/^image\//.test(res.type)) { res.text = new TextDecoder().decode(res.bytes); try { res.json = JSON.parse(res.text); } catch { res.json = null; } }
      const shownBody = /^image\//.test(res.type) ? `<${res.bytes.length} bytes ${res.type}>` : sanitize(res.text, [c.adminKey]).replace(/\s+/g, ' ').slice(0, 200);
      res.brief = `${method} ${shown} -> ${r.status}${res.location ? ' location ' + pathOf(res.location, c.origin) : ''}: ${shownBody}`;
    } catch (e) {
      res.error = e?.name === 'TimeoutError' ? 'timeout after ' + Math.round(Math.max(5000, c.ms(20000)) / 1000) + ' s' : sanitize(String(e?.message || e), [c.adminKey]);
      res.brief = `${method} ${shown} -> no response (${res.error})`;
    }
    return res;
  };
}
function openSocket(c, guest) {
  const u = new URL('/rt/ws', c.origin); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; u.searchParams.set('topic', TOPIC); u.searchParams.set('room', ROOM);
  const s = { guest, msgs: [], waiters: [], closed: false, opened: false, closeInfo: '' };
  const ws = s.ws = new c.WebSocket(u.href, ['masil2', 'at.' + guest.token]); // net.js DOChan.open: the token is a subprotocol, never in the URL
  const wake = () => { for (const w of [...s.waiters]) w(); };
  ws.onopen = () => { s.opened = true; s.pt = setInterval(() => { try { if (ws.readyState === 1) ws.send('ping'); } catch { } }, 25000); }; // the Room auto-answers 'pong'; stale after 75 s
  ws.onmessage = (e) => { const d = typeof e.data === 'string' ? e.data : String(e.data); if (d === 'pong') return; let m; try { m = JSON.parse(d); } catch { return; } s.msgs.push(m); wake(); };
  ws.onclose = (e) => { s.closed = true; s.closeInfo = `code ${e?.code ?? '?'}${e?.reason ? ' ' + e.reason : ''}`; clearInterval(s.pt); wake(); };
  ws.onerror = () => { };
  s.mark = () => s.msgs.length;
  s.send = (o) => { if (ws.readyState !== 1) return false; ws.send(JSON.stringify(o)); return true; };
  // the first message from index `from` on that matches, or null after ms (or when the socket closes)
  s.maybe = (pred, ms, from = 0) => new Promise((resolve) => {
    let t = null; const w = () => { for (let i = from; i < s.msgs.length; i++) if (pred(s.msgs[i])) return end(s.msgs[i]); if (s.closed) end(null); };
    const end = (v) => { clearTimeout(t); s.waiters = s.waiters.filter((x) => x !== w); resolve(v); };
    t = setTimeout(() => end(null), c.ms(ms)); s.waiters.push(w); w();
  });
  s.waitFor = async (pred, ms, what, from = 0) => { const m = await s.maybe(pred, ms, from); if (m) return m;
    throw new StepStop(s.closed ? `${guest.nick}'s socket closed (${s.closeInfo}) while waiting for ${what}` : `timeout after ${Math.round(c.ms(ms) / 1000)} s waiting for ${what} on ${guest.nick}'s socket`); };
  s.close = () => { clearInterval(s.pt); try { if (ws.readyState <= 1) ws.close(1000); } catch { } };
  return s;
}
function stepApi(c, step) {
  const line = (status, what, detail) => { c.rows.push({ status, step, what, detail: detail || '' }); c.log(`${status.padEnd(4)}  ${step.padEnd(10)}  ${what}${detail ? '  (' + detail + ')' : ''}`); };
  const t = {
    pass: (what, detail) => line('PASS', what, detail), fail: (what, detail) => line('FAIL', what, detail), skip: (what, detail) => line('SKIP', what, detail),
    check(what, cond, failDetail, passDetail) { if (cond) line('PASS', what, passDetail); else line('FAIL', what, failDetail); return !!cond; },
    // an HTTP answer with this status whose JSON passes pred; a FAIL shows method, path, status and the first 200 characters of the body
    expect(what, res, status, pred = () => true, passDetail) {
      let ok = Array.isArray(status) ? status.includes(res.status) : res.status === status, why = '';
      if (ok) { try { ok = !!pred(res.json || {}, res); } catch (e) { ok = false; why = String(e?.message || e); } }
      if (ok) line('PASS', what, typeof passDetail === 'function' ? passDetail(res.json || {}, res) : passDetail);
      else line('FAIL', what, (why ? why + '; ' : '') + `want ${[].concat(status).join('/')}; ` + res.brief);
      return ok;
    },
  };
  return t;
}
async function poll(c, fn, tries, every) { let last = null; for (let i = 0; i < tries; i++) { last = await fn(i); if (last?.done) return last; if (i < tries - 1) await c.sleep(every); } return last; }
const need = (cond, msg) => { if (!cond) throw new StepStop(msg); };
const guestLabel = (g) => `${g.nick} ${mask(g.sub)}`;
async function walletOf(c, g) { const r = await c.api(g, 'GET', '/rt/wallet'); return { r, coins: Number(r.json?.coins), exists: r.json?.exists === true }; }
async function flush(c, g) { return c.api(g, 'POST', '/rt/flush-wallet', { topic: TOPIC, nickname: g.nick }); }
function recordWish(c, id) { let row = c.state.wishes.find((x) => x.id === id); if (!row) { row = { id, day: kstDay(c.now()), hidden: false }; c.state.wishes.push(row); c.save(); } return row; }
// A wish POST without an answer may still have gone up: read the guest's own wish and keep it for cleanup.
async function lostWish(c, g) { for (let i = 0; i < 3; i++) { const r = await c.api(g, 'GET', '/rt/wishes'); if (r.status === 200) { const id = r.json?.mine && !r.json.mine.hidden ? String(r.json.mine.id || '') : ''; if (WISH_ID.test(id)) recordWish(c, id); return WISH_ID.test(id) ? id : ''; } await c.sleep(3000); } return ''; }
async function worldNow(c) { const r = await c.api(null, 'GET', '/rt/world'); return { r, world: r.status === 200 && r.json && Array.isArray(r.json.billboards) ? r.json : null }; }

// ---------- steps ----------
const STEPS = {
  async admin(t, c) {
    const s = await c.api(null, 'GET', '/rt/admin/stats', undefined, { admin: true });
    if (s.status === 401) throw new KeyRefused('operator key in .dev.vars is not the production key');
    if (!t.expect('operator key accepted by /rt/admin/stats', s, 200, (j) => j.ok === true && Array.isArray(j.days), (j) => 'today ' + j.today)) throw new KeyRefused('/rt/admin/stats did not answer 200 ok:true; nothing was created');
    const h = await c.api(null, 'GET', '/rt/health');
    t.expect('worker has its secrets (/rt/health)', h, 200, (j) => j.hasFlushKey === true && j.hasGuestKey === true && j.mode === 'DO');
    // the check must not add load to a service that is already limiting itself
    const g = await c.api(null, 'GET', '/rt/gate');
    if (!t.expect('budget gate is open and not lean (/rt/gate)', g, 200, (j) => j.ok === true && !j.lean && !j.full, (j) => `used ${j.used}`)) throw new KeyRefused('the budget gate is not open (lean, hard or full); not adding load. Nothing was created');
    const left = kstMinutesToMidnight(c.now());
    if (left < 15) c.log(`NOTE  admin       ${left} min to 00:00 KST: wish and relight checks may cross the day and fail`);
  },
  async guests(t, c) {
    const st = c.state;
    if (c.fresh && st.guests.length) { st.retired.push(...st.guests); st.guests = []; c.save(); }
    for (let i = 0; i < NICKS.length; i++) {
      const nick = NICKS[i], saved = st.guests[i];
      let g = null, how = '';
      if (saved?.token && saved.exp * 1000 > c.now() + 864e5) { g = saved; how = 'reused'; }
      else if (saved?.token) { const r = await c.api(null, 'POST', '/rt/guest', { t: saved.token }); // renewal: same id, not counted by GUEST_RL
        if (r.status === 200 && r.json?.sub === saved.sub && String(r.json.token || '').startsWith('g1.')) { g = { nick, token: r.json.token, sub: r.json.sub, exp: r.json.exp }; how = 'renewed'; }
        else { t.skip(`renew ${nick}`, 'saved token no longer valid, minting a new guest; ' + r.brief); st.retired.push(saved); } }
      if (!g) {
        let r = null;
        for (let k = 0; k < 3; k++) { r = await c.api(null, 'POST', '/rt/guest', {}); if (r.status !== 429) break; const wait = Math.max(5, Number(r.headers.get('retry-after')) || 60); c.log(`NOTE  guests      GUEST_RL (10 new guests per minute per IP): waiting ${wait} s`); await c.sleep(wait * 1000 + 1000); }
        if (!t.expect(`mint ${nick} (POST /rt/guest)`, r, 200, (j) => String(j.token || '').startsWith('g1.') && SUB_RE.test(j.sub || '') && j.exp * 1000 > c.now(), (j) => mask(j.sub))) throw new StepStop('could not mint ' + nick);
        g = { nick, token: r.json.token, sub: r.json.sub, exp: r.json.exp }; how = 'minted';
      }
      g.nick = nick; st.guests[i] = { nick, token: g.token, sub: g.sub, exp: g.exp }; c.save();
      c.guests[i] = { ...st.guests[i], id: 'guest:' + g.sub };
      if (how !== 'minted') t.pass(`${nick} ready`, `${how} ${mask(g.sub)}`);
    }
  },
  async enter(t, c) {
    for (const g of c.guests) {
      const s = g.sock = openSocket(c, g);
      let ok = await s.maybe((m) => m.t === 'ok' || m.t === 'wait' || m.t === 'down', 20000);
      if (ok?.t === 'wait') { const q = ok; ok = await s.maybe((m) => m.t === 'ok', 30000); need(ok, `${g.nick} is queued (position ${q.pos}, ${q.live}/${q.cap} in the room) and was not admitted in 30 s`); }
      need(ok && ok.t !== 'down', ok?.t === 'down' ? 'the Room answered down (daily budget at the hard level)' : `${g.nick}'s socket got no 'ok' in 20 s (${s.closed ? 'closed ' + s.closeInfo + ' — 400 bad topic, 401 token, 429 moving rooms too often or 503 budget' : s.opened ? 'open but silent' : 'never opened'})`);
      t.pass(`${g.nick} joined ${TOPIC}`, `live ${ok.live ?? '?'} / cap ${ok.cap ?? '?'}`);
      // net.js has no hello of its own: main.js enter() sends BONUS hello once the socket is online; the Room pays it once per account.
      const from = s.mark(); s.send({ t: 'BONUS', kind: 'hello', amount: BALANCE.firstCoins, nick: g.nick });
      if (c.state.hello[g.sub]) {
        const again = await s.maybe((m) => m.t === 'PAY' && m.kind === 'hello', 4000, from);
        t.check(`${g.nick}: hello is not paid twice`, !again, `a second hello PAY of ${again?.amount} arrived`, 'paid on an earlier run, no second PAY');
      } else {
        const pay = await s.waitFor((m) => m.t === 'PAY' && m.kind === 'hello', 10000, 'the hello PAY', from);
        if (t.check(`${g.nick}: hello PAY`, pay.amount === PAY.hello, `amount ${pay.amount}, want ${PAY.hello}`, `+${pay.amount}`)) { c.state.hello[g.sub] = 1; c.save(); }
      }
      // The Room batches coins into coin_batch about every 30 s; /rt/flush-wallet settles this account now and the wallet row appears.
      const w = await poll(c, async (i) => { const f = await flush(c, g); const got = await walletOf(c, g); return { done: f.status === 200 && got.exists, f, got, i }; }, 8, 5000);
      t.check(`${g.nick}: wallet row exists`, w?.done, `after ${8} flushes: ${w?.f?.brief} / ${w?.got?.r?.brief}`, `${w?.got?.coins} coins`);
    }
  },
  async coins(t, c) {
    const g1 = c.guests[0];
    const before = await walletOf(c, g1);
    need(before.exists, 'guest 1 has no wallet row: ' + before.r.brief);
    if (before.coins >= GRANT_BELOW) { t.skip(`operator grant to ${guestLabel(g1)}`, `the wallet already has ${before.coins} coins (grants only below ${GRANT_BELOW})`); return; }
    const from = g1.sock?.mark() ?? 0;
    const r = await c.api(null, 'POST', '/rt/admin/coins', { actor_id: g1.id, amount: GRANT }, { admin: true });
    t.expect(`operator grants ${GRANT} coins to ${guestLabel(g1)}`, r, 200, (j) => j.ok === true && Number(j.coins) === before.coins + GRANT, (j) => `${before.coins} -> ${j.coins}`);
    const after = await walletOf(c, g1);
    t.check('the wallet shows the grant', after.coins === before.coins + GRANT, `wallet ${after.coins}, want ${before.coins + GRANT}; ${after.r.brief}`, `${after.coins} coins`);
    if (g1.sock) { const sync = await g1.sock.maybe((m) => m.t === 'WALLET_SYNC', 8000, from); if (sync) t.pass('WALLET_SYNC reached guest 1 (nudge)'); else t.skip('WALLET_SYNC reached guest 1 (nudge)', 'not seen in 8 s; the nudge is best effort'); }
  },
  async wish(t, c) {
    const [g1, g2, g3] = c.guests;
    const l1 = await c.api(g1, 'GET', '/rt/wishes');
    need(t.expect('guest 1 reads GET /rt/wishes', l1, 200, (j) => 'mine' in j && Array.isArray(j.recent)), 'cannot read the wish list');
    // refusals with guest 3, who has no wish yet: a refusal must not use up the day's wish
    const l3 = await c.api(g3, 'GET', '/rt/wishes');
    if (l3.json?.mine) t.skip('link and phone refusals', 'guest 3 already has a wish today');
    else {
      for (const [what, text] of [['a wish with a link is refused with link', WISH_LINK], ['a wish with a phone number is refused with link', WISH_PHONE]]) {
        const r = await c.api(g3, 'POST', '/rt/wish', { text, nick: g3.nick, topic: TOPIC });
        const up = r.json?.ok === true && WISH_ID.test(r.json.wish?.id || '') ? r.json.wish.id : !r.json ? await lostWish(c, g3) : '';
        if (up) { const row = recordWish(c, up); // it went up: hide it right away
          const h = await c.api(null, 'POST', '/rt/admin/wish', { id: up, hide: true }, { admin: true }); if (h.json?.ok) { row.hidden = true; c.save(); } }
        t.expect(what, r, 400, (j) => j.ok === false && j.code === 'link');
      }
      const l3b = await c.api(g3, 'GET', '/rt/wishes');
      t.expect("the refusals did not use guest 3's wish for today", l3b, 200, (j) => j.mine === null);
    }
    let w = l1.json.mine;
    if (w?.hidden) { t.skip('post, edit, hearts, focus, board', `guest 1's wish for ${kstDay(c.now())} (KST) was hidden by an earlier run; run after 00:00 KST or with --fresh`); return; }
    if (w) t.skip('post a wish', `guest 1 already has today's wish ${w.id} from an earlier run; reusing it`);
    else {
      const fan = g2?.sock?.mark() ?? 0;
      const p = await c.api(g1, 'POST', '/rt/wish', { text: WISH_TEXT, nick: g1.nick, topic: TOPIC });
      if (p.json?.wish?.id && WISH_ID.test(p.json.wish.id)) recordWish(c, p.json.wish.id);
      else if (!p.json) { const id = await lostWish(c, g1); if (id) t.fail('guest 1 posts a wish', `no answer, but the wish ${id} went up (kept for cleanup); ${p.brief}`); }
      need(t.expect('guest 1 posts a wish', p, 200, (j) => j.ok === true && j.fresh === true && WISH_ID.test(j.wish?.id) && j.wish.txt === cleanWish(WISH_TEXT), (j) => 'id ' + j.wish.id), 'no wish to test with');
      w = p.json.wish;
      const e = await c.api(g1, 'POST', '/rt/wish', { text: WISH_EDIT, nick: g1.nick, topic: TOPIC });
      t.expect('an immediate edit is refused with soon', e, 409, (j) => j.ok === false && j.code === 'soon');
      if (g2?.sock) { const m = await g2.sock.maybe((x) => x.t === 'WISH' && x.w?.id === w.id, 8000, fan); t.check('the fresh wish reaches the room as WISH', m, 'guest 2 got no {t:WISH} in 8 s', 'guest 2 got it'); }
    }
    const l1b = await c.api(g1, 'GET', '/rt/wishes');
    t.expect("it is guest 1's mine and in recent", l1b, 200, (j) => j.mine?.id === w.id && j.mine.mine === true && j.recent.some((x) => x.id === w.id));
    c.wish = { id: w.id, txt: l1b.json?.mine?.txt || w.txt, hearts: Number(l1b.json?.mine?.hearts) || 0 };
    const l2 = await c.api(g2, 'GET', '/rt/wishes'), left0 = Number(l2.json?.left);
    if ((l2.json?.given || []).includes(w.id)) t.skip("guest 2 hearts guest 1's wish", 'guest 2 already hearted it on an earlier run');
    else { const h = await c.api(g2, 'POST', '/rt/wish/heart', { id: w.id });
      t.expect("guest 2 hearts guest 1's wish", h, 200, (j) => j.ok === true && j.hearts === c.wish.hearts + 1 && j.left === left0 - 1, (j) => `hearts ${j.hearts}, left ${left0} -> ${j.left}`); }
    t.expect('a second heart on the same wish is refused with dup', await c.api(g2, 'POST', '/rt/wish/heart', { id: w.id }), 400, (j) => j.ok === false && j.code === 'dup');
    t.expect('guest 1 hearting their own wish is refused with own', await c.api(g1, 'POST', '/rt/wish/heart', { id: w.id }), 400, (j) => j.ok === false && j.code === 'own');
    t.expect('GET /rt/wishes?id= returns focus', await c.api(g2, 'GET', '/rt/wishes?id=' + w.id), 200, (j) => j.focus?.id === w.id && j.focus.txt === c.wish.txt, (j) => 'rank ' + j.focus.rank);
    // /rt/world: 15 s per isolate plus the Cache API copy; the posting isolate refills at once, others after their copy ages out
    const b = await poll(c, async (i) => { const { r, world } = await worldNow(c); return { done: !!world?.wish?.board?.some((x) => x.id === w.id), r, i }; }, 13, 5000);
    t.check('the wish shows in /rt/world wish.board', b?.done, `not there after ~60 s; ${b?.r?.brief}`, `after ~${(b?.i || 0) * 5} s`);
  },
  async share(t, c) {
    if (!c.wish) { t.skip('share checks', 'no visible wish from the wish step'); return; }
    const [g1, g2] = c.guests, wid = c.wish.id, jpeg = c.jpeg;
    need(jpeg && jpeg.length >= 800 && jpeg.length <= 900000 && jpeg[0] === 0xff && jpeg[1] === 0xd8, 'og.jpg is not a JPEG between 800 B and 900 KB');
    // share.js snapQuery + net.js publishShot: POST /rt/snap?wish=<id>, raw JPEG body, content-type image/jpeg
    const up = await c.api(g1, 'POST', '/rt/snap?wish=' + wid, jpeg);
    const shotOf = (j) => { const m = /^\/rt\/snap\/([0-9a-f]{32})$/.exec(pathOf(j.url, c.origin)); return m ? m[1] : ''; };
    need(t.expect('guest 1 uploads a photo of the wish (POST /rt/snap?wish=)', up, 200, (j) => j.ok === true && shotOf(j) && /^\/rt\/s\/[0-9a-f]{32}$/.test(pathOf(j.page, c.origin)), (j) => mask(shotOf(j))), 'no photo to check');
    const shot = shotOf(up.json); c.state.snaps.push(shot); c.save();
    const page = await c.api(null, 'GET', pathOf(up.json.page, c.origin));
    t.expect('GET /rt/s/<id> has og:image /rt/snap/<id>', page, 200, (j, r) => /text\/html/.test(r.type) && pathOf(metaContent(r.text, 'og:image'), c.origin) === '/rt/snap/' + shot && metaContent(r.text, 'twitter:card') === 'summary_large_image',
      (j, r) => 'title ' + metaContent(r.text, 'og:title'));
    const img = await c.api(null, 'GET', '/rt/snap/' + shot);
    t.expect('that og:image is the JPEG', img, 200, (j, r) => /^image\/jpeg/.test(r.type) && r.bytes.length === jpeg.length, (j, r) => r.bytes.length + ' bytes');
    // /rt/w/<id>: the author's newest shot of the wish; other isolates may hold a 60 s lookup cache
    const wp = await poll(c, async (i) => { const r = await c.api(null, 'GET', '/rt/w/' + wid); return { done: r.status === 200 && pathOf(metaContent(r.text, 'og:image'), c.origin) === '/rt/snap/' + shot, r, i }; }, 15, 5000);
    t.check('GET /rt/w/<wish> uses the uploaded photo', wp?.done, `og:image ${metaContent(wp?.r?.text, 'og:image')}; ${wp?.r?.brief}`, `after ~${(wp?.i || 0) * 5} s`);
    t.check('GET /rt/w/<wish> has the wish text in og:description', metaContent(wp?.r?.text, 'og:description') === c.wish.txt, `og:description ${JSON.stringify(metaContent(wp?.r?.text, 'og:description'))}, want ${JSON.stringify(c.wish.txt)}`);
    const up2 = await c.api(g2, 'POST', '/rt/snap?wish=' + wid, jpeg);
    const shot2 = up2.json ? shotOf(up2.json) : ''; if (shot2) { c.state.snaps.push(shot2); c.save(); }
    t.expect("guest 2's upload with the same ?wish= is still accepted", up2, 200, (j) => j.ok === true && !!shot2);
    const wp2 = await c.api(null, 'GET', '/rt/w/' + wid);
    t.check("guest 2's upload does not replace the wish preview", pathOf(metaContent(wp2.text, 'og:image'), c.origin) === '/rt/snap/' + shot, `og:image ${metaContent(wp2.text, 'og:image')}; ${wp2.brief}`);
    if (shot2) { const p2 = await c.api(null, 'GET', '/rt/s/' + shot2);
      t.expect("guest 2's photo page has no wish context (site title)", p2, 200, (j, r) => metaContent(r.text, 'og:title') === SITE_TITLE); }
  },
  async push(t, c) {
    // Only the key: a made-up subscription would make the server push to a made-up endpoint.
    t.expect('GET /rt/push/key returns the VAPID public key', await c.api(null, 'GET', '/rt/push/key'), 200, (j) => typeof j.k === 'string' && /^[\w-]{80,}$/.test(j.k), (j) => mask(j.k));
  },
  async board(t, c) {
    const [g1, g2] = c.guests;
    const { r: wr, world } = await worldNow(c);
    need(world, 'cannot read /rt/world: ' + wr.brief);
    const cfg = await c.api(null, 'GET', '/rt/config');
    need(cfg.status === 200 && Array.isArray(cfg.json?.starter), 'cannot read the free-first slots from /rt/config: ' + cfg.brief); // never guess which boards are free-first
    const cands = slotCandidates(world, starterOf(cfg.json));
    if (cands.length < 2) { t.skip('claim, relight, cheer, inbox', `${cands.length} empty non-starter board(s) left; the run never takes the last one`); return; }
    const { slot, bid } = cands[0];
    const f = await flush(c, g1); need(f.status === 200, 'cannot settle guest 1 before the claim: ' + f.brief);
    const coins = Number(f.json.coins);
    need(coins >= bid, `guest 1 has ${coins} coins, the cheapest empty board ${slot} needs ${bid}`);
    // ui.js claim sheet -> main.js claim() -> net.js _plazaPost: this body, mode left out for a normal claim
    const body = { slot_id: slot, bid, line1: BOARD_LINES[0], line2: BOARD_LINES[1], line3: BOARD_LINES[2], caption_y: 72, emoji: '🔥', bg_theme: 'cyber_navy', text_color: '#ffffff', external_url: '', nickname: g1.nick, topic: TOPIC };
    const from2 = g2.sock?.mark() ?? 0, day = kstDay(c.now()), sentAt = c.now(); // sentAt: no later than the server's claim time, so the cleanup window errs short
    const keep = (until) => { if (!c.state.slots.some((s) => s.slot === slot && s.at === sentAt)) { const pu = Date.parse(until || ''); c.state.slots.push({ slot, by: g1.sub, at: sentAt, until: Math.min(sentAt + CLEANUP_WINDOW_MS, Number.isFinite(pu) ? pu : Infinity), status: 'held' }); c.save(); } };
    const cl = await c.api(g1, 'POST', '/rt/claim-billboard', body);
    if (cl.json?.ok === true && cl.json?.data?.slot_id === slot) keep(cl.json.data.protected_until);
    else if (!cl.json) { // no answer: the claim may still have gone through; the world copy is at most 15 s old
      const got = await poll(c, async () => { const x = await worldNow(c); return { done: x.world?.billboards?.find((y) => y.slot_id === slot)?.holder_id === g1.id }; }, 5, 5000);
      if (got?.done) { keep(''); t.fail(`guest 1 claims ${slot}`, `no answer, but guest 1 holds it now (kept for cleanup); ${cl.brief}`); return; } }
    if (cl.json?.review_id) { t.fail(`claim ${slot} at ${bid}`, 'went to review (S tier?): ' + cl.brief); return; }
    need(t.expect(`guest 1 claims ${slot} at the minimum bid ${bid}`, cl, 200, (j) => j.ok === true && j.kind === 'BILLBOARD' && j.data?.holder_id === g1.id && j.data.line1 === BOARD_LINES[0] && Number(j.remaining_coins) === coins - bid, (j) => `remaining ${j.remaining_coins}`), 'claim failed');
    const litUntil = cl.json.data.lit_until;
    const seen = await poll(c, async (i) => { const x = await worldNow(c); const b = x.world?.billboards?.find((y) => y.slot_id === slot); return { done: b?.holder_id === g1.id, b, r: x.r, i }; }, 9, 5000);
    t.check('/rt/world shows guest 1 as the holder', seen?.done, `holder ${mask(seen?.b?.holder_id)} after ~40 s; ${seen?.r?.brief}`, `after ~${(seen?.i || 0) * 5} s`);
    const w = await walletOf(c, g1);
    t.check('the wallet dropped by the bid', w.coins === coins - bid, `wallet ${w.coins}, want ${coins - bid}; ${w.r.brief}`, `${coins} -> ${w.coins}`);
    if (g2.sock) { const u = await g2.sock.maybe((m) => m.t === 'WORLD_UPDATE' && m.kind === 'BILLBOARD' && m.data?.slot_id === slot, 8000, from2); t.check('the room got WORLD_UPDATE for the board', u, 'guest 2 saw no WORLD_UPDATE in 8 s'); }
    let rl = await c.api(g1, 'POST', '/rt/relight', { slot, topic: TOPIC });
    if (rl.status === 429) { await new Promise((ok) => setTimeout(ok, 3200)); rl = await c.api(g1, 'POST', '/rt/relight', { slot, topic: TOPIC }); } // one relight per account per 3 s (real time): an earlier run's, retried once
    if (kstDay(c.now()) !== day) t.skip('same-day relight keeps the clock', 'the KST day changed since the claim');
    else t.expect('a same-day relight keeps the clock', rl, 200, (j) => j.ok === true && Math.abs(Date.parse(j.lit_until) - Date.parse(litUntil)) < 1000 && j.scored !== true, (j) => `lit_until ${j.lit_until}, lit_days ${j.lit_days}`);
    // main.js cheer() -> tribe.js sendCheer: {t:'CHEER', slot, p} over the socket; the Room pays PAY kind cheer and queues an inbox row for the holder.
    // Right after the claim on purpose: the Room keeps the claim's WORLD_UPDATE row (or reads the board), so the holder is known at once. No retry.
    if (!g2.sock || !g1.sock) { t.skip('cheer and inbox', 'no sockets'); return; }
    const from1 = g1.sock.mark(), from = g2.sock.mark(), cheerAt = c.now();
    need(g2.sock.send({ t: 'CHEER', slot, p: 1 }), "guest 2's socket is not open");
    const pay = await g2.sock.waitFor((m) => m.t === 'PAY' && m.kind === 'cheer', 10000, 'the cheer PAY', from);
    t.check('guest 2 cheers the board and gets a PAY', pay.amount > 0, `PAY amount 0, why ${pay.why}${pay.why === 'wait' ? ' (the Room could not tell the holder: no WORLD_UPDATE row kept and the board read failed)' : pay.why === 'dark' ? ' (the Room sees the board as not lit or not held by guest 1)' : ''}`, `+${pay.amount}`);
    const note = await g1.sock.maybe((m) => m.t === 'INBOX' && m.kind === 'cheer' && m.slot_id === slot && m.from === g2.id, 5000, from1);
    t.check('guest 1 gets the cheer live (INBOX)', note, "no {t:INBOX, kind:cheer} from guest 2 on guest 1's socket in 5 s");
    // inbox rows go out with the Room's coin flush (flushInbox after coin_batch); settling guest 2 runs that flush now
    const f2 = await flush(c, g2); t.expect("settle guest 2 (flushes the room's inbox queue)", f2, 200, (j) => j.ok === true);
    const inb = await poll(c, async (i) => { const r = await c.api(g1, 'GET', '/rt/inbox'); const it = (r.json?.items || []).find((x) => x.kind === 'cheer' && x.slot_id === slot && x.from === g2.id && Date.parse(x.created_at) >= cheerAt - 600000); return { done: !!it, it, r, i }; }, 12, 5000);
    if (!t.check("guest 1's /rt/inbox has the cheer row", inb?.done, `none after ~60 s; ${inb?.r?.brief}`, `id ${inb?.it?.id} after ~${(inb?.i || 0) * 5} s`)) return;
    if (!t.expect('POST /rt/inbox/read marks it read', await c.api(g1, 'POST', '/rt/inbox/read', { ids: [inb.it.id] }), 200, (j) => j.ok === true)) return;
    // `read` is in GET /rt/inbox only once the optional inbox_list migration is in the database; without it only the POST answer can be checked
    if (typeof inb.it.read !== 'boolean') { t.skip('the read flag is visible', 'GET /rt/inbox has no read flag (inbox_list migration not applied); only the POST answer was checked'); return; }
    t.check('the row was unread before', inb.it.read === false, `read ${inb.it.read} before POST /rt/inbox/read`);
    const back = await c.api(g1, 'GET', '/rt/inbox'), again = (back.json?.items || []).find((x) => x.id === inb.it.id);
    t.check('GET /rt/inbox shows it read', back.status === 200 && again?.read === true, again ? `read ${again.read}; ${back.brief}` : `the row is gone from GET /rt/inbox; ${back.brief}`);
  },
  async moderation(t, c) {
    if (!c.wish) { t.skip('moderation checks', 'no visible wish from the wish step'); return; }
    const wid = c.wish.id, [g1, g2] = c.guests;
    const list = await c.api(null, 'GET', '/rt/admin/wishes', undefined, { admin: true });
    t.expect('GET /rt/admin/wishes lists the test wish', list, 200, (j) => j.ok === true && j.wishes.some((x) => x.id === wid && x.hidden === false));
    const h = await c.api(null, 'POST', '/rt/admin/wish', { id: wid, hide: true }, { admin: true });
    if (t.expect('POST /rt/admin/wish hides it', h, 200, (j) => j.ok === true)) { const row = c.state.wishes.find((x) => x.id === wid); if (row) row.hidden = true; c.save(); }
    t.expect('it is gone from GET /rt/wishes', await c.api(g2, 'GET', '/rt/wishes'), 200, (j) => !j.top.some((x) => x.id === wid) && !j.recent.some((x) => x.id === wid));
    t.expect('guest 1 sees their wish as hidden', await c.api(g1, 'GET', '/rt/wishes'), 200, (j) => j.mine?.id === wid && j.mine.hidden === true);
    const rd = await poll(c, async (i) => { const r = await c.api(null, 'GET', '/rt/w/' + wid); return { done: r.status === 302 && pathOf(r.location, c.origin) === '/', r, i }; }, 8, 5000); // single-wish cache: 10 s per isolate
    t.check('GET /rt/w/<wish> redirects to /', rd?.done, rd?.r?.brief, `after ~${(rd?.i || 0) * 5} s`);
    t.expect('the operator list shows it hidden', await c.api(null, 'GET', '/rt/admin/wishes', undefined, { admin: true }), 200, (j) => j.wishes.some((x) => x.id === wid && x.hidden === true));
  },
  async cleanup(t, c) {
    const st = c.state;
    if (c.keep) t.skip('hide wishes, clean boards', '--keep: left as they are; run again with --only=cleanup to remove them');
    else {
      for (const w of st.wishes.filter((x) => !x.hidden)) {
        const r = await c.api(null, 'POST', '/rt/admin/wish', { id: w.id, hide: true }, { admin: true });
        if (t.expect(`hide wish ${w.id}`, r, [200, 404], (j, res) => j.ok === true || res.status === 404, (j, res) => res.status === 404 ? 'already gone' : '')) { w.hidden = true; c.save(); }
      }
      // takedown_billboard and the holder edit do not check who holds the board, so this is the only guard: act only on a fresh world read that
      // shows one of our guests as holder, inside the claim's protection window (nobody else can have taken it then). Anything else is left for a person.
      const pending = st.slots.filter((x) => x.status === 'held');
      const pause = (ms) => new Promise((r) => setTimeout(r, c.ms(ms))); // not c.sleep: cleanup also runs after Ctrl+C
      const guestOf = (id) => [...st.guests, ...st.retired].find((g) => 'guest:' + g.sub === id) || null, lastEdit = new Map();
      let world = pending.length ? (await worldNow(c)).world : null;
      const rowOf = (slot) => world?.billboards?.find((x) => x.slot_id === slot);
      // no holder shown: the isolate's world copy (15 s) may predate the claim; read again once it has aged out (the second read must succeed too)
      if (world && pending.some((s) => !rowOf(s.slot)?.holder_id)) { await pause(16000); world = (await worldNow(c)).world; }
      for (const s of pending) {
        const b = world ? rowOf(s.slot) : null, holder = String(b?.holder_id || ''), g = guestOf(holder);
        const why = !world ? '/rt/world could not be read' : !b ? 'the board is not in /rt/world' : !g ? (holder ? 'someone else holds it now' : 'it shows no holder')
          : !(c.now() < Number(s.until || Number(s.at) + CLEANUP_WINDOW_MS) - 60000) ? 'the claim is older than its 30-minute protection, someone may have outbid it' : '';
        if (why) { s.hand = why; c.save(); t.skip(`clean ${s.slot}`, `handle by hand: ${s.slot} (${why})`); continue; }
        // first choice: the holder's own edit to neutral lines (ui.js edit: mode 'edit', bid = current bid, so nothing is charged)
        const edit = { slot_id: s.slot, bid: Number(b.current_bid) || 0, line1: NEUTRAL_LINES[0], line2: NEUTRAL_LINES[1], line3: NEUTRAL_LINES[2], caption_y: 72, emoji: '🌠', bg_theme: b.bg_theme || 'cyber_navy', text_color: b.text_color || '#ffffff', external_url: '', mode: 'edit', nickname: g.nick, topic: TOPIC };
        // the Worker answers 429 to a second edit by one account inside 3 s (real time, so not c.ms): wait between this guest's edits, retry a 429 once
        const gap = (lastEdit.get(g.sub) || 0) + 3200 - Date.now(); if (gap > 0) await new Promise((r) => setTimeout(r, gap));
        let r = await c.api(g, 'POST', '/rt/claim-billboard', edit); lastEdit.set(g.sub, Date.now());
        if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3200)); r = await c.api(g, 'POST', '/rt/claim-billboard', edit); lastEdit.set(g.sub, Date.now()); }
        let done = r.json?.ok === true && r.json.data?.line1 === NEUTRAL_LINES[0] && r.json.data.holder_id === holder;
        if (!r.json) { await pause(16000); const nb = (await worldNow(c)).world?.billboards?.find((y) => y.slot_id === s.slot); done = nb?.holder_id === holder && nb.line1 === NEUTRAL_LINES[0]; if (done) r = { json: { data: nb } }; } // no answer: did the edit land?
        if (done) { s.status = 'neutral'; s.lit = r.json.data.lit_until || ''; delete s.hand; c.save(); t.pass(`edit ${s.slot} to neutral lines as its holder`, `held by ${g.nick} until ${s.lit || '?'}`); continue; }
        t.fail(`edit ${s.slot} to neutral lines as its holder`, 'refused, taking it down instead; ' + r.brief);
        const d = await c.api(null, 'POST', '/rt/admin/takedown', { slot: s.slot }, { admin: true });
        if (t.expect(`take ${s.slot} down (POST /rt/admin/takedown)`, d, 200, (j) => j.ok === true && j.billboard?.line1 === TAKEDOWN_LINE, (j) => `holder stays until ${j.billboard?.lit_until || '?'}`)) { s.status = 'down'; s.lit = d.json.billboard?.lit_until || ''; delete s.hand; c.save(); }
        else { s.hand = 'edit and takedown both failed'; c.save(); c.log(`NOTE  cleanup     handle by hand: ${s.slot} (edit and takedown both failed)`); }
      }
    }
  },
};

// ---------- runner ----------
// deps: { origin, adminKey, fetch, WebSocket, jpeg, statePath, only, keep, fresh, log, timeScale, stop }
export async function run(deps) {
  const c = { ...deps, rows: [], guests: [], wish: null, log: deps.log || ((s) => console.log(s)), now: deps.now || (() => Date.now()), stop: deps.stop || { aborted: false } };
  const scale = Number(deps.timeScale) > 0 ? Number(deps.timeScale) : 1;
  c.ms = (x) => Math.max(1, Math.round(x * scale));
  c.sleep = async (x) => { if (c.stop.aborted) throw new StepStop('interrupted'); await new Promise((r) => setTimeout(r, c.ms(x))); if (c.stop.aborted) throw new StepStop('interrupted'); };
  c.api = makeApi(c);
  c.statePath = deps.statePath || defaultStatePath(c.origin);
  const bad = originFault(c.origin) || stateFault(c.statePath); if (bad) { c.log(bad); return 2; }
  try { c.state = loadState(c.statePath, c.origin); } catch (e) { c.log('state: ' + e.message); return 2; }
  c.save = () => { try { fs.writeFileSync(c.statePath, JSON.stringify(c.state, null, 1), { mode: 0o600 }); } catch (e) { c.log('NOTE  could not write the state file: ' + e.message); } };
  if (!deps.fresh) c.guests = c.state.guests.map((g) => ({ ...g, id: 'guest:' + g.sub })); // cleanup-only runs still know the wallets
  c.log(`prod-e2e against ${c.origin}  state ${c.statePath}  KST ${new Date(c.now() + 9 * 36e5).toISOString().slice(0, 16).replace('T', ' ')}`);
  const plan = planSteps(deps.only), status = {};
  let code = null, halt = '';
  for (const name of plan) {
    if (name === 'cleanup') continue;
    const t = stepApi(c, name);
    if (c.stop.aborted) { t.skip('not run', 'interrupted'); status[name] = 'skipped'; continue; }
    const unmet = NEEDS[name].filter((d) => status[d] !== 'done');
    if (unmet.length) { t.skip('not run', 'needs ' + unmet.join(', ')); status[name] = 'skipped'; continue; }
    try { await STEPS[name](t, c); status[name] = 'done'; }
    catch (e) {
      if (e instanceof KeyRefused) { t.fail('run stopped', e.message); halt = e.message; code = 2; break; }
      t.fail('step stopped', e instanceof StepStop ? e.message : 'unexpected: ' + sanitize(e?.stack || e, [c.adminKey]).split('\n').slice(0, 3).join(' | ')); status[name] = 'failed';
    }
  }
  if (code === null) { const t = stepApi(c, 'cleanup'); try { await STEPS.cleanup(t, c); } catch (e) { t.fail('step stopped', sanitize(e?.message || e, [c.adminKey])); } }
  for (const g of c.guests) g.sock?.close();
  if (code === 2) { c.log(halt); return 2; }
  const sum = summaryTable(c.rows);
  c.log('\nSummary\n' + sum.text);
  const left = [...c.state.guests, ...c.state.retired];
  if (left.length) {
    c.log('\nLeft behind (wallets cannot be deleted through the API; ids and tokens are in the state file):');
    for (const g of left) { const w = await walletOf(c, { token: g.token }); c.log(`  wallet ${g.nick} ${mask(g.sub)}  ${w.exists ? w.coins + ' coins' : w.r.status === 200 ? 'no wallet row' : 'unreadable (' + w.r.status + ')'}`); }
    const by = (k) => c.state.slots.filter((s) => s.status === k), list = (a) => a.map((s) => s.slot + (s.lit ? ' (lit until ' + s.lit + ')' : '')).join(', ');
    if (by('neutral').length) c.log(`  boards edited to "${NEUTRAL_LINES.join(' / ')}", still held by a test guest for 72 h from the claim: ${list(by('neutral'))}`);
    if (by('down').length) c.log(`  boards taken down ("${TAKEDOWN_LINE}"), still held by a test guest for 72 h from the claim: ${list(by('down'))}`);
    for (const s of by('held')) c.log(`  handle by hand: ${s.slot}${s.hand ? ' (' + s.hand + ')' : c.keep ? ' (--keep: still shows the test lines)' : ''}`);
    if (c.state.slots.length) c.log('  a real player who takes a test board over sends 80% of the test bid back to the test wallet as a refund; billboard_history and coin_ledger rows stay');
    const wishes = c.state.wishes.filter((w) => !w.hidden).map((w) => w.id);
    if (wishes.length) c.log(`  wishes still visible: ${wishes.join(', ')}`);
    if (c.state.wishes.length) c.log(`  each test wish used one of this network's ${WISH.ipPostsPerDay} new wishes for its KST day (wish ipPostsPerDay)`);
    if (c.state.snaps.length) c.log(`  photos in the snaps store (pruned after 7 days): ${c.state.snaps.length}`);
    c.log(`  the state file holds live guest tokens: ${c.statePath} (delete it when you no longer need these guests)`);
  }
  return sum.FAIL ? 1 : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.errors.length) {
    for (const e of args.errors) console.error(e);
    console.error('usage: node tools/prod-e2e.mjs <origin> [--only=' + STEP_NAMES.join(',') + '] [--keep] [--fresh] [--state=<file>]');
    process.exit(args.help ? 0 : 64);
  }
  if (typeof globalThis.WebSocket !== 'function') { console.error('this needs Node 22+ (global WebSocket)'); process.exit(64); }
  let dev = null; try { dev = parseDevVars(fs.readFileSync(path.resolve('.dev.vars'), 'utf8')); } catch { dev = null; }
  if (!dev) { console.error('cannot read ./.dev.vars: run this from the repo root'); process.exit(2); }
  if (!dev.ADMIN_KEY) { console.error('./.dev.vars has no ADMIN_KEY'); process.exit(2); }
  const stop = { aborted: false };
  process.on('SIGINT', () => { if (stop.aborted) process.exit(130); stop.aborted = true; console.log('\ninterrupted: finishing the current request, then cleaning up (Ctrl+C again to quit now)'); });
  const code = await run({ origin: args.origin, adminKey: dev.ADMIN_KEY, fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, jpeg: new Uint8Array(fs.readFileSync(new URL('../og.jpg', import.meta.url))),
    statePath: args.state ? path.resolve(args.state) : '', only: args.only, keep: args.keep, fresh: args.fresh, stop });
  process.exit(code);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
