import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };

const { Room, Meter } = await import('../worker.js');
const worker = (await import('../worker.js')).default;
const { EVENT_NAMES } = await import('../plaza-account.js');
const { gaName, gaParams, GA_PARAMS } = await import('../analytics.js');
const { GROW_STEPS, MIN_BASE, growDays, growSum, stepPct, dayShift, daysBetween, backFields, returnGap } = await import('../growth.js');
const share = await import('../share.js');

// Same harness as wish.test.mjs / share-push.test.mjs: the real Meter and Room on in-memory SQLite.
function sqliteStorage(db = new DatabaseSync(':memory:')) {
  return {
    db,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^create\b/i.test(q)) { db.exec(q); return { rowsWritten: 0, toArray() { return []; }, one() { return {}; }, [Symbol.iterator]() { return [][Symbol.iterator](); } }; }
      const stmt = db.prepare(q);
      if (/^select\b/i.test(q)) { const rows = stmt.all(...args); return { rowsWritten: 0, toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('expected one row for ' + q); return rows[0]; }, [Symbol.iterator]: () => rows[Symbol.iterator]() }; }
      const info = stmt.run(...args);
      return { rowsWritten: info.changes, toArray: () => [], one() { throw new Error('one on write'); }, [Symbol.iterator]() { return [][Symbol.iterator](); } };
    },
  };
}
function makeCtx(sql) {
  return {
    storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, transactionSync(fn) { sql.db.exec('BEGIN'); try { const out = fn(); sql.db.exec('COMMIT'); return out; } catch (e) { sql.db.exec('ROLLBACK'); throw e; } } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {},
  };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const KEY = 'admin-test-key-123', DAY = 86400000;
function harness(env) {
  const ctx = { waitUntil() {} };
  const call = (path, opt = {}) => worker.fetch(new Request('https://sq.example' + path, opt), env, ctx);
  const post = (body, token) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const guest = async () => (await call('/rt/guest', post({}))).json();
  const ev = (name, sid, who, p) => call('/rt/event', post({ name, sid, p }, who?.token));
  const stats = async (q = '') => (await call('/rt/admin/stats' + q, { headers: { 'x-admin-key': KEY } })).json();
  return { call, guest, ev, stats };
}
function withClock(start, fn) {
  const orig = Date.now; let t = start; Date.now = () => t;
  return Promise.resolve(fn({ add: (ms) => { t += ms; } })).finally(() => { Date.now = orig; });
}
const NOON = Date.parse('2027-04-05T03:00:00Z'); // 12:00 KST

describe('G2 growth funnel in the stats readout', { concurrency: false }, () => {
  it('counts each step once per account per day, folds guests into their user, and counts account-less sessions one each', async () => {
    await withClock(NOON, async (clock) => {
      const env = makeEnv(), { guest, ev, stats } = harness(env);
      const A = await guest(), B = await guest(), C = await guest();
      // A: lands, enters, posts a wish, shares twice in two tabs, comes back. Two tabs must not make two people.
      await ev('page_landing', 'sess-a-0001'); await ev('enter_square', 'sess-a-0001', A); await ev('wish_post', 'sess-a-0001', A, { fresh: 1 });
      await ev('wish_share', 'sess-a-0001', A, { how: 'copied' }); await ev('share_link', 'sess-a-0001', A, { kind: 'wish' });
      await ev('page_landing', 'sess-a-0002', A); await ev('enter_square', 'sess-a-0002', A); await ev('return_visit', 'sess-a-0002', A, { gap: 2 });
      // B arrives by a wish link and enters; never shares.
      await ev('page_landing', 'sess-b-0001', B); await ev('wish_land', 'sess-b-0001', B, { found: 1 }); await ev('enter_square', 'sess-b-0001', B);
      // C arrives by a board card link, copies an invite (share_send).
      await ev('page_landing', 'sess-c-0001', C); await ev('focus_enter', 'sess-c-0001', C); await ev('share_send', 'sess-c-0001', C);
      // Someone with no account at all: two bounced tabs, two sessions.
      await ev('page_landing', 'sess-x-0001'); await ev('page_landing', 'sess-x-0002');
      let s = await stats();
      // landing: A, B, C and two account-less sessions; enter: A, B; wish: A; share: A (wish_share + share_link) and C (share_send);
      // arrived by link: B (wish_land) and C (focus_enter); back: A.
      assert.deepEqual(s.days[0].grow, [5, 2, 1, 2, 2, 1]);
      assert.equal(GROW_STEPS.length, 6);
      // C links to a user: the guest and the user are one person the same day.
      const store = env.METER.get('ev');
      await store.evAlias('guest:' + C.sub, 'user:u-c');
      await ev('wish_post', 'sess-c-0002', C); // a second tab of the same person: one more account on that step, not two
      await ev('wish_post', 'sess-c-0003', C);
      s = await stats();
      assert.deepEqual(s.days[0].grow, [5, 2, 2, 2, 2, 1]);
      assert.equal(s.days[0].visitors, 3);
      assert.equal(clock.add(0), undefined);
    });
  });
  it('keeps the numbers after the day is folded, and reports days the funnel did not exist for as unknown', async () => {
    await withClock(NOON, async (clock) => {
      const env = makeEnv(), { guest, ev, stats } = harness(env);
      const A = await guest();
      await ev('page_landing', 'sess-a-0001', A); await ev('enter_square', 'sess-a-0001', A); await ev('wish_post', 'sess-a-0001', A);
      clock.add(DAY);
      await ev('page_landing', 'sess-a-0002', A); // the first event of the next day folds the day before
      const s = await stats('?days=3');
      const by = Object.fromEntries(s.days.map((d) => [d.day, d]));
      assert.deepEqual(by['2027-04-05'].grow, [1, 1, 1, 0, 0, 0]);
      assert.deepEqual(by['2027-04-06'].grow, [1, 0, 0, 0, 0, 0]);
      // A folded row from before this build has no `grow`: growDays marks it unknown (null), a day with no row at all is zeros.
      const old = [{ day: '2027-04-06', visitors: 1 }, { day: '2027-04-05', grow: [30, 20, 10, 5, 2, 1] }];
      const cols = growDays(old, '2027-04-06', 3);
      assert.equal(cols[0].counts, null);
      assert.deepEqual(cols[1].counts, [30, 20, 10, 5, 2, 1]);
      assert.deepEqual(cols[2].counts, [0, 0, 0, 0, 0, 0]);
      assert.deepEqual(growSum(cols, 3), { counts: [30, 20, 10, 5, 2, 1], known: 2 });
    });
  });
  it('accepts return_visit, still refuses unknown names, and sends only GA4-safe names and parameters to gtag', async () => {
    await withClock(NOON, async () => {
      const env = makeEnv(), { ev } = harness(env);
      assert.equal((await ev('return_visit', 'sess-r-0001')).status, 200);
      assert.equal((await ev('return', 'sess-r-0001')).status, 400);
    });
    for (const n of EVENT_NAMES) { assert.equal(gaName(n), n, n); assert.match(n, /^[a-z][a-z0-9_]{0,39}$/); }
    assert.equal(gaName('Wish Heart!'), 'wish_heart_');
    assert.equal(gaName('9lives'), 'lives');
    assert.equal(gaName('x'.repeat(60)).length, 40);
    // Only the keys the callers use today reach Google; scalars only, strings cut to 100.
    assert.deepEqual(gaParams({ slot: 'MAIN_TOP', streak: 3, fresh: true, tier: 'C', o: { a: 1 }, ref: 'y'.repeat(150) }), { slot: 'MAIN_TOP', streak: 3, fresh: 1, ref: 'y'.repeat(100), tier: 'C' });
    assert.deepEqual(gaParams({ text: '소원 글', nick: '지민', wish: '합격', txt: 'x', Slot: 'MAIN_TOP', 'bad key': 1, n: 3 }), {}); // player-written text and unknown keys never go out
    assert.deepEqual(gaParams({ nick: '지민', how: 'copied', pic: 1 }), { how: 'copied', pic: 1 });
    assert.deepEqual(gaParams(null), {});
    // Every key a caller sends today is on the list.
    const sent = new Set();
    for (const f of ['../ui.js', '../main.js']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      for (const m of src.matchAll(/trackEvent\('[a-z_]+', \{([^}]*)\}/g)) for (const k of m[1].matchAll(/(?:^|,)\s*([a-z_]+)\s*(?::|(?=,|$))/g)) sent.add(k[1]);
    }
    assert.ok(sent.size >= 8, [...sent].join());
    assert.deepEqual([...sent].filter((k) => !GA_PARAMS.includes(k)), []);
  });
});

describe('G2 funnel table maths (growth.js)', () => {
  it('shows a dash when the base step has fewer than 20', () => {
    assert.equal(MIN_BASE, 20);
    const c = [200, 80, 20, 40, 20, 24];
    assert.equal(stepPct(c, 0), '');
    assert.equal(stepPct(c, 1), '40%'); // 입장 / 방문
    assert.equal(stepPct(c, 2), '25%'); // 소원 / 입장
    assert.equal(stepPct(c, 3), '50%'); // 공유 / 입장
    assert.equal(stepPct(c, 4), '50%'); // 공유로 들어옴 / 공유
    assert.equal(stepPct(c, 5), '30%'); // 재방문 / 입장
    assert.equal(stepPct([100, 19, 5, 0, 0, 0], 2), '—'); // 입장 is 19, under the floor
    assert.equal(stepPct([100, 20, 5, 0, 0, 0], 2), '25%');
    assert.equal(stepPct([19, 10, 0, 0, 0, 0], 1), '—');
    assert.equal(stepPct([], 1), '—');
  });
  it('builds today-first calendar columns and sums only the days that are known', () => {
    const days = [{ day: '2027-04-07', grow: [5, 4, 3, 2, 1, 0] }, { day: '2027-04-05', grow: [10, 9, 8, 7, 6, 5] }];
    const cols = growDays(days, '2027-04-07', 7);
    assert.deepEqual(cols.map((c) => c.day), ['2027-04-07', '2027-04-06', '2027-04-05', '2027-04-04', '2027-04-03', '2027-04-02', '2027-04-01']);
    assert.deepEqual(cols[1].counts, [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(growSum(cols, 7).counts, [15, 13, 11, 9, 7, 5]);
    assert.deepEqual(growSum(cols, 2).counts, [5, 4, 3, 2, 1, 0]);
    assert.equal(dayShift('2027-03-01', -1), '2027-02-28');
    assert.equal(growDays([{ day: '2027-04-07', grow: [1, 2, 3] }], '2027-04-07', 1)[0].counts, null); // a row of the wrong shape is unknown, not zeros
    assert.deepEqual(growDays([{ day: '2027-04-07', grow: ['x', -3, 2.9, 1, 0, 7] }], '2027-04-07', 1)[0].counts, [0, 0, 2, 1, 0, 7]);
  });
});

describe('G2 KakaoTalk share behind a key', () => {
  it('GET /rt/config carries kakao only when KAKAO_JS_KEY is set, and never anything else of the env', async () => {
    const none = harness(makeEnv()), off = await (await none.call('/rt/config')).json();
    assert.equal('kakao' in off, false);
    // starter: the free first-slot list (package db), not env; starter_fallback: true while this isolate has no list from the database
    assert.deepEqual(Object.keys(off).filter((k) => k !== 'starter_fallback').sort(), ['key', 'starter', 'url']);
    assert.ok(!('starter_fallback' in off) || off.starter_fallback === true);
    assert.ok(Array.isArray(off.starter) && off.starter.every((s) => /^STREET_\d+$/.test(s)));
    const KEYV = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const on = await (await harness(makeEnv({ KAKAO_JS_KEY: KEYV })).call('/rt/config')).json();
    assert.equal(on.kakao, KEYV);
    assert.equal(on.url, off.url); assert.equal(on.key, off.key);
    // A blank, spaced-out or junk value must not reach the page.
    for (const bad of ['', '   ', 'short', 'has space in the middle of it', '<script>alert(1)</script>']) {
      assert.equal('kakao' in (await (await harness(makeEnv({ KAKAO_JS_KEY: bad })).call('/rt/config')).json()), false, JSON.stringify(bad));
    }
    assert.equal((await none.call('/rt/config', { method: 'POST' })).status, 405);
  });
  it('builds the feed payload from the same title, text and link as the link share', () => {
    const SNAP = 'a'.repeat(32), O = 'https://studio.wishboard.workers.dev';
    const page = `${O}/rt/s/${SNAP}`;
    const p = share.kakaoFeed({ title: '지민님의 소원', text: '"합격하게 해주세요" — 하트 하나만 눌러 주세요', url: page, origin: O });
    assert.equal(p.objectType, 'feed');
    assert.equal(p.content.title, '지민님의 소원');
    assert.equal(p.content.description, '"합격하게 해주세요" — 하트 하나만 눌러 주세요');
    assert.equal(p.content.imageUrl, `${O}/rt/snap/${SNAP}`);
    assert.deepEqual(p.content.link, { mobileWebUrl: page, webUrl: page });
    assert.deepEqual(p.buttons[0].link, { mobileWebUrl: page, webUrl: page });
    // The invite parameter and a plain wish link both ride along unchanged; no snapshot means og.jpg.
    const w = `${O}/rt/w/abcdefghij?inv=ab12cd34`;
    const q = share.kakaoFeed({ title: 't', text: 'x', url: w, origin: O });
    assert.equal(q.content.link.webUrl, w);
    assert.equal(q.content.imageUrl, `${O}/og.jpg`);
    assert.equal(share.kakaoImage(`${page}?inv=ab12cd34`, O + '/'), `${O}/rt/snap/${SNAP}`);
    assert.equal(share.kakaoImage('', O), `${O}/og.jpg`);
    assert.equal(share.kakaoFeed({ title: 'x'.repeat(500), text: 'y'.repeat(500), url: w }).content.title.length, 200);
  });
  it('pins the SDK to a version with a sha384 integrity and loads it once, inits once, and falls back on any failure', async () => {
    assert.match(share.KAKAO_SDK.src, /^https:\/\/t1\.kakaocdn\.net\/kakao_js_sdk\/\d+\.\d+\.\d+\/kakao\.min\.js$/);
    assert.ok(share.KAKAO_SDK.src.includes('/' + share.KAKAO_SDK.version + '/'));
    assert.match(share.KAKAO_SDK.integrity, /^sha384-[A-Za-z0-9+/]{64}$/);
    const KEYV = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const mk = (outcome) => {
      const tags = [], win = {}, doc = { head: { append(el) { tags.push(el); queueMicrotask(() => outcome(el, win)); } }, createElement: () => ({}) };
      return { tags, win, doc };
    };
    // 1. A blocked CDN: onerror. No SDK, no throw, kakaoSend says false so the caller uses sendLink.
    const blocked = mk((el) => el.onerror());
    assert.equal(await share.loadKakao(KEYV, blocked), null);
    assert.equal(await share.kakaoSend(KEYV, { objectType: 'feed' }, blocked), false);
    assert.equal(await share.kakaoSend(KEYV, { objectType: 'feed' }, blocked), false);
    assert.equal(blocked.tags.length, 1); // a failed load is remembered for the page: one script, not one per tap
    assert.equal(blocked.tags[0].src, share.KAKAO_SDK.src);
    assert.equal(blocked.tags[0].integrity, share.KAKAO_SDK.integrity);
    assert.equal(blocked.tags[0].crossOrigin, 'anonymous');
    // 2. No key: nothing is loaded at all.
    const keyless = mk(() => {});
    assert.equal(await share.loadKakao('', keyless), null);
    assert.equal(keyless.tags.length, 0);
    // 3. The SDK throws in sendDefault: false, not a rejection.
    const boom = mk((el, win) => { win.Kakao = { isInitialized: () => false, init() {}, Share: { sendDefault() { throw new Error('domain not registered'); } } }; el.onload(); });
    assert.equal(await share.kakaoSend(KEYV, { objectType: 'feed' }, boom), false);
  });
  it('loads once and calls Kakao.init and Share.sendDefault with the payload', async () => {
    const KEYV = 'a1b2c3d4e5f60718293a4b5c6d7e8f90', calls = { init: [], sent: [] }, tags = [];
    let up = false;
    const win = {}, doc = { head: { append(el) { tags.push(el); queueMicrotask(() => { win.Kakao = { isInitialized: () => up, init(k) { up = true; calls.init.push(k); }, Share: { sendDefault(p) { calls.sent.push(p); } } }; el.onload(); }); } }, createElement: () => ({}) };
    const payload = share.kakaoFeed({ title: 'a', text: 'b', url: 'https://studio.wishboard.workers.dev/' });
    assert.equal(await share.kakaoSend(KEYV, payload, { doc, win }), true);
    assert.equal(await share.kakaoSend(KEYV, payload, { doc, win }), true);
    assert.equal(tags.length, 1);
    assert.deepEqual(calls.init, [KEYV]);
    assert.deepEqual(calls.sent, [payload, payload]);
  });
  it('reads the key from a /rt/config answer and treats a missing or broken one as no key (net.js keeps it; see polish.test.mjs)', () => {
    assert.equal(share.kakaoOf({ url: 'u', key: 'k', kakao: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }), 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
    for (const j of [null, {}, { kakao: '' }, { kakao: 'short' }, { kakao: 'a b c d e f g h i j k' }, { kakao: 12345678901234567 }]) assert.equal(share.kakaoOf(j), '', JSON.stringify(j));
  });
});

describe('G2 wiring in the client sources', () => {
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  it('wires return_visit to the attendance record, and shows the Kakao button only after the key is known', () => {
    assert.match(ui, /const gap = returnGap\(d, recall\('kts_daily', \{\}\), d\.day\);/);
    assert.match(ui, /d\.backSent = 1; saveDay\(d\); if \(gap\) trackEvent\('return_visit', \{ gap \}\)/);
    assert.match(ui, /\.\.\.backFields\(prev, day\)/);
    assert.match(ui, /async function sendKakao[^\n]*\n\s*if \(shareBusy\) return 'busy';\n\s*shareBusy = true;/); // a double tap cannot open two Kakao sheets
    assert.match(ui, /viaKakao \? \[new Promise\(\(r\) => setTimeout\(\(\) => r\(''\), 1000\)\)\] : \[\]/); // the picture is not waited for longer than ~1 s before Kakao's popup
    assert.match(ui, /카카오톡으로 보내기', hidden: true/);
    assert.match(ui, /kakaoKey\(\)\.then\(\(k\) => \{ if \(k\)/);
    // Both share rows fall back to sendLink when Kakao does not take the share.
    assert.match(ui, /\(await sendKakao\(words\)\) \|\| \(await sendLink\(/);
    assert.match(ui, /viaKakao && \(await sendKakao\(\{ kind: 'wish'[^)]*\)+ \|\| \(await sendLink\(/);
  });
  it('keeps the GA id in one constant, still switched off by the placeholder, and puts no Kakao key in any file', () => {
    const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    // One real GA4 id or the placeholder; the tag is added to the page only for a real id.
    assert.equal((idx.match(/GA_MEASUREMENT_ID = '/g) || []).length, 1);
    assert.match(idx, /const GA_MEASUREMENT_ID = 'G-[A-Z0-9]{8,12}';/);
    assert.match(idx, /if \(GA_MEASUREMENT_ID && GA_MEASUREMENT_ID !== 'G-XXXXXXXXXX'\) \{/);
    assert.equal((idx.match(/googletagmanager\.com/g) || []).length, 1);
    const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
    assert.match(worker, /env\.KAKAO_JS_KEY/);
    assert.equal(/Kakao\.init\(['"]/.test(ui + readFileSync(new URL('../share.js', import.meta.url), 'utf8')), false);
  });
  it('does not load the Google tag while the address carries a sign-in code or a handover ticket', () => {
    const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const src = (idx.match(/<script>\s*(const GA_MEASUREMENT_ID[\s\S]*?)<\/script>/) || [])[1] || '';
    assert.ok(src.length > 100);
    // The tag script itself, run with a made-up address and a clock the test turns by hand.
    const page = (search) => {
      const window = {}, location = { search }, tags = [], timers = new Map();
      let seq = 0;
      runInNewContext(src, {
        window, location,
        document: { createElement: () => ({}), head: { appendChild: (s) => tags.push(s.src) } },
        setInterval: (fn) => { timers.set(++seq, fn); return seq; },
        clearInterval: (id) => { timers.delete(id); },
      });
      const tick = (times = 1) => { for (let i = 0; i < times; i++) for (const fn of [...timers.values()]) fn(); };
      return { location, tags, timers, tick, queued: Array.from(window.dataLayer, (a) => a[0]) }; // Array.from: an array of this context
    };
    // A plain address: the tag goes in at once, and nothing keeps polling.
    for (const search of ['', '?focus=PLOT_3&ref=ab12cd34', '?policy=privacy', '?barcode=1&decode=2']) {
      const p = page(search);
      assert.equal(p.tags.length, 1, search);
      assert.match(p.tags[0], /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-[A-Z0-9]{8,12}$/);
      assert.equal(p.timers.size, 0);
    }
    // Back from sign-in (?code=) or through a handover link: no tag until the app has taken the value out of the address.
    for (const search of ['?code=abc-123', '?focus=PLOT_3&code=abc-123', '?handover=h1.xyz.sig&autologin=google']) {
      const p = page(search);
      assert.deepEqual(p.queued, ['js', 'config']); // the commands wait in dataLayer for the tag
      p.tick(5);
      assert.deepEqual(p.tags, [], search);
      p.location.search = search.includes('focus') ? '?focus=PLOT_3' : '';
      p.tick();
      assert.equal(p.tags.length, 1, search);
      assert.equal(p.timers.size, 0);
      p.tick(3);
      assert.equal(p.tags.length, 1); // loaded once
    }
    // Still there after 30 s (120 polls of 250 ms): the poll stops and this page view has no tag.
    const stuck = page('?code=never-used');
    stuck.tick(119);
    assert.equal(stuck.timers.size, 1);
    stuck.tick();
    assert.equal(stuck.timers.size, 0);
    stuck.location.search = '';
    stuck.tick(5);
    assert.deepEqual(stuck.tags, []);
    assert.match(src, /\}, 250\);/);
  });
  it('says in the privacy policy that visits are counted with Google Analytics', () => {
    const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    if (/const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';/.test(idx)) return; // no tag on the page, nothing to disclose
    const legal = readFileSync(new URL('../legal.js', import.meta.url), 'utf8');
    const privacy = legal.slice(legal.indexOf('function privacy()'), legal.indexOf('function terms()'));
    assert.match(privacy, /Google 애널리틱스/);
    assert.match(privacy, /_ga/); // the cookie
    assert.match(privacy, /tools\.google\.com\/dlpage\/gaoptout/); // how to refuse
    assert.equal(/Google/.test(legal.slice(legal.indexOf('function terms()'))), false);
  });
  it('renders the funnel with textContent only', () => {
    const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
    const fn = html.slice(html.indexOf('function renderGrow'), html.indexOf("$('statsLoad').onclick"));
    assert.ok(fn.length > 200);
    assert.equal(/innerHTML|insertAdjacentHTML/.test(fn), false);
    assert.match(html, /from '\.\/growth\.js\?v=\d+'/);
  });
});

describe('G2 return_visit decision (growth.js)', () => {
  // The decision a tab makes at enter: backFields when the day record is built, returnGap just before sending.
  const open = (stored, day) => ({ day, last: stored?.last || '', ...backFields(stored, day) });
  it('does nothing for a first-ever visit, and nothing again on the same day', () => {
    const first = open(null, '2027-04-05');
    assert.deepEqual([first.back, first.backSent], [0, 0]);
    assert.equal(returnGap(first, null, '2027-04-05'), 0);
    // A later load on the same day (the record the first visit saved) still says nothing.
    const again = open({ ...first, last: '2027-04-05' }, '2027-04-05');
    assert.equal(returnGap(again, { ...first, last: '2027-04-05' }, '2027-04-05'), 0);
    assert.equal(returnGap(open({}, '2027-04-05'), {}, '2027-04-05'), 0);
    assert.equal(returnGap(open({ day: '2027-04-05', last: '' }, '2027-04-05'), null, '2027-04-05'), 0);
  });
  it('reports the gap in days on a later day: 1 the next day, 3 three days later, capped at 365', () => {
    const rec = { day: '2027-04-05', last: '2027-04-05', backSent: 0 };
    assert.equal(returnGap(open(rec, '2027-04-06'), rec, '2027-04-06'), 1);
    assert.equal(returnGap(open(rec, '2027-04-08'), rec, '2027-04-08'), 3);
    assert.equal(returnGap(open({ day: '2024-01-01', last: '2024-01-01' }, '2027-04-08'), null, '2027-04-08'), 365);
    assert.equal(daysBetween('2027-04-05', '2027-04-05'), 0);
    assert.equal(daysBetween('2027-04-06', '2027-04-05'), 0);
    assert.equal(daysBetween('', '2027-04-05'), 0);
    assert.equal(daysBetween(undefined, '2027-04-05'), 0);
  });
  it('treats a record from an older build (no back, no backSent) as nothing to send on its own day, and as a return on a later one', () => {
    const old = { day: '2027-04-05', last: '2027-04-04', streak: 2, earn: 5 };
    assert.deepEqual(backFields(old, '2027-04-05'), { back: 0, backSent: 0 });
    assert.equal(returnGap(open(old, '2027-04-05'), old, '2027-04-05'), 0);
    assert.equal(returnGap(open(old, '2027-04-07'), old, '2027-04-07'), 3); // last attended on the 4th
  });
  it('sends at most once a day: not when this tab already sent, and not when another tab already stored backSent', () => {
    const rec = { day: '2027-04-05', last: '2027-04-05' };
    const mine = open(rec, '2027-04-06');
    assert.equal(returnGap(mine, rec, '2027-04-06'), 1);
    // This tab sent and saved: a reload of the same day carries backSent and stays quiet.
    const saved = { ...mine, last: '2027-04-06', backSent: 1 };
    assert.deepEqual(backFields(saved, '2027-04-06'), { back: 1, backSent: 1 });
    assert.equal(returnGap(open(saved, '2027-04-06'), saved, '2027-04-06'), 0);
    // A second tab opened the same new day before the first one entered: its own record still has backSent 0,
    // but kts_daily now says the first tab sent.
    assert.equal(returnGap(mine, saved, '2027-04-06'), 0);
    // An old record of another day in storage does not block.
    assert.equal(returnGap(mine, { day: '2027-04-05', backSent: 1 }, '2027-04-06'), 1);
    assert.equal(returnGap(null, saved, '2027-04-06'), 0);
  });
});
