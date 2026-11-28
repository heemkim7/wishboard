// 출시 예정 (2026-11-28): the four coming features (soonrules.js), what the Worker counts for them (giftsrv.js soonSeen / giftDb.soonAdd:
// impressions, taps, one registration per person and feature), who is left out (the operator's device, the e2e tool, budget hard), the
// admin block, the account flows (a link joins a guest's interest to the account, a withdrawal deletes it) and what the pages say.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeEnv, harness, withClock, KEY, worker } from './reinforce-harness.mjs';
import { SOON, SOON_IDS, SOON_SRC, SOON_LABEL, SOON_BTN, SOON_THANKS, SOON_INTRO, SOON_FREE, SOON_KEEP, soonFault, soonKeys, soonReport } from '../soonrules.js';
import { TIERS, kstDay, addDays } from '../giftrules.js';
import { giftSeenFlush } from '../giftsrv.js';

const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const T0 = Date.parse('2027-03-10T03:00:00Z'); // 12:00 KST
const db = (env) => env.meter('gift').sql.db;
const has = (env, t) => db(env).prepare("select count(*) n from sqlite_master where name = ?").get(t).n > 0; // the gift DO made its tables (it was called)
const counts = (env, d) => (has(env, 'gd') ? Object.fromEntries(db(env).prepare("select k, n from gd where d = ? and k like 'si:%'").all(d).map((x) => [x.k, x.n])) : {});
const people = (env) => db(env).prepare('select f, w, lg, src from gsi order by f, src').all().map((x) => ({ ...x }));
const VIS = (n) => String(n).padStart(16, 'b');

// The network as the Worker sees it here: the JWKS for an account's token, Supabase's RPCs answer ok.
function net(state) {
  return async (url) => {
    const u = String(url);
    if (u.includes('/.well-known/jwks.json')) return Response.json({ keys: state.jwks || [] });
    if (u.includes('/rpc/merge_guest_account')) return Response.json({ ok: true, coins: 1, bonus: 0 });
    if (u.includes('/rpc/') || u.includes('/rest/v1/')) return Response.json(u.includes('/rest/v1/') ? [] : { ok: true });
    return new Response('missing', { status: 404 });
  };
}
// One signing key for the file: the Worker keeps the JWKS it read for a while, so every test signs with the same one.
const PAIR = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']), JWK = { ...(await crypto.subtle.exportKey('jwk', PAIR.publicKey)), kid: 'soon-kid' };
async function userToken(state, now, sub) {
  const kid = 'soon-kid', pair = PAIR;
  state.jwks = [JWK];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid });
  const claims = enc({ sub, exp: Math.floor(now / 1000) + 3600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
  return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub };
}
// One test's world: the real Worker on SQLite, its own clock, the fetch above; flush() sends what the isolate holds (the beacon batch).
async function world(fn, extra = {}) {
  const prev = globalThis.fetch, state = {};
  globalThis.fetch = net(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  try {
    await withClock(T0 + Math.floor(Math.random() * 1e6), async (clock) => {
      const env = makeEnv(extra), H = harness(env);
      const send = (body, { token = '', ip = '1.1.1.1', h = {} } = {}) => H.call('/rt/gift/soon', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}), ...h }, body: JSON.stringify(body) });
      const flush = async () => { await giftSeenFlush(env, H.ctx); await H.settle(); };
      try { await fn({ env, H, send, flush, clock, state }); } finally { await flush(); }
    });
  } finally { globalThis.fetch = prev; }
}

describe('the four coming features (soonrules.js)', () => {
  it('four, each with a name, one line, a line icon, the quiet label and the one button', () => {
    assert.deepEqual(SOON_IDS, ['board', 'gift', 'keep', 'place']);
    assert.deepEqual(SOON.map((x) => x.name), ['특별한 전광판', '선물 특별 연출·선물 보관함', '오래 남기기', '특별한 자리']);
    const icons = src('uiicons.js');
    for (const F of SOON) { assert.ok(F.line.length > 20 && F.line.length < 80, F.id); assert.ok(icons.includes('  ' + F.icon + ': '), F.icon); }
    assert.equal(SOON_LABEL, '출시 예정'); assert.equal(SOON_BTN, '이 기능에 관심 있어요'); assert.equal(SOON_THANKS, '관심을 담았어요. 고마워요!');
    assert.equal(SOON_INTRO, '준비 중인 기능이에요. 관심을 눌러 주시면 무엇부터 만들지 정하는 데 써요.');
    assert.match(SOON_FREE, /무료/);
  });
  it('sells nothing: no price, date, buy or pay word, no promise of a notice, nothing premium', () => {
    const all = [SOON_LABEL, SOON_BTN, SOON_THANKS, SOON_INTRO, SOON_FREE, ...SOON.flatMap((x) => [x.name, x.line])].join(' | ');
    assert.equal(/[0-9][0-9,]*\s*원|₩|가격|요금|결제|구매|구독|유료|프리미엄|할인|사기|살 수|팔|주문|체험/.test(all), false, 'no price, pay or buy word');
    assert.equal(/20[0-9]{2}|[0-9]+월|[0-9]+일에|곧|다음 주|이번 달|오픈|출시일|예정일/.test(all), false, 'no launch date');
    assert.equal(/알려 드|알림|연락|이메일|전화|준비되면/.test(all), false, 'no promise to tell anyone');
    for (const t of TIERS.filter((x) => x.price)) assert.equal(all.includes(t.price.toLocaleString('ko-KR')), false, 'no hidden tier price: ' + t.price);
  });
  it('none of them is what is free today (the 3D pop-out real video, card image, the 15 s film, the main tower minute, making and sharing)', () => {
    const feats = SOON.map((x) => x.name + ' ' + x.line).join(' | ');
    assert.equal(/실사|튀어나|3D|입체|카드 이미지|축하 영상|15초|메인 타워|1분|롤링페이퍼|공유|만들기|하트/.test(feats), false);
    assert.match(SOON[2].line, /7일이 지나도/, '오래 남기기 is past the free 7 days');
  });
  it('checks a beacon: imp up to the four ids, tap exactly one, a known source', () => {
    assert.deepEqual(soonFault({ a: 'imp', f: ['board', 'keep'], s: 'owner' }), { ok: true, a: 'imp', fs: ['board', 'keep'], s: 'owner' });
    assert.deepEqual(soonFault({ a: 'tap', f: 'gift', s: 'plaza' }), { ok: true, a: 'tap', fs: ['gift'], s: 'plaza' });
    for (const b of [{ a: 'tap', f: ['board', 'gift'], s: 'owner' }, { a: 'imp', f: ['board', 'nope'], s: 'owner' }, { a: 'imp', f: 'board', s: 'x' }, { a: 'reg', f: 'board', s: 'owner' }, { a: 'imp', f: [], s: 'soon' }, null])
      assert.equal(soonFault(b).ok, false, JSON.stringify(b));
    assert.deepEqual(soonKeys('keep', 'tap', 'a', 'more'), ['si:keep:tap', 'si:keep:tap:a', 'si:keep:tap@more']);
    assert.deepEqual(SOON_SRC, ['owner', 'me', 'more', 'plaza', 'soon']);
  });
});

describe('POST /rt/gift/soon (giftsrv.js) and the admin block', () => {
  it('counts impressions and every tap; one person tapping twice is one registration; a guest, an account and a token-less browser split', async () => {
    await world(async ({ env, H, send, flush, clock, state }) => {
      const G = await H.guest(), U = await userToken(state, clock.now(), '11111111-2222-3333-4444-555555555555'), d = kstDay(clock.now());
      assert.deepEqual(await (await send({ a: 'imp', f: ['board', 'gift', 'keep', 'place'], s: 'owner' }, { token: G.token })).json(), { ok: true, kept: true });
      for (let i = 0; i < 2; i++) assert.equal((await (await send({ a: 'tap', f: 'keep', s: 'owner', v: VIS(1) }, { token: G.token })).json()).kept, true);
      await send({ a: 'imp', f: ['keep'], s: 'more' }, { token: U.token }); await send({ a: 'tap', f: 'keep', s: 'more' }, { token: U.token });
      await send({ a: 'tap', f: 'keep', s: 'soon', v: VIS(2) }); await send({ a: 'tap', f: 'keep', s: 'soon', v: VIS(2) }); // no token: this browser's id
      await send({ a: 'tap', f: 'place', s: 'plaza', v: VIS(1) }, { token: G.token });
      await flush();
      const c = counts(env, d);
      assert.equal(c['si:board:imp'], 1); assert.equal(c['si:keep:imp'], 2); assert.equal(c['si:keep:imp:g'], 1); assert.equal(c['si:keep:imp:a'], 1); assert.equal(c['si:keep:imp@owner'], 1); assert.equal(c['si:keep:imp@more'], 1);
      assert.equal(c['si:keep:tap'], 5, 'every press'); assert.equal(c['si:keep:reg'], 3, 'the guest, the account and the browser once each');
      assert.equal(c['si:keep:reg:a'], 1); assert.equal(c['si:keep:reg:g'], 2); assert.equal(c['si:keep:reg@soon'], 1); assert.equal(c['si:place:reg@plaza'], 1);
      const P = people(env);
      assert.equal(P.length, 4); assert.ok(P.every((p) => /^[0-9a-f]{16}$/.test(p.w)), 'a keyed hash only');
      assert.equal(JSON.stringify(P).includes(G.id) || JSON.stringify(P).includes(U.id) || JSON.stringify(P).includes(VIS(2)), false, 'never the id itself');
      assert.deepEqual(P.filter((p) => p.f === 'keep').map((p) => p.lg).sort(), [0, 0, 1]);
      // the next day the same person again: still one
      clock.add(864e5); await send({ a: 'tap', f: 'keep', s: 'owner', v: VIS(1) }, { token: G.token }); await flush();
      const c2 = counts(env, kstDay(clock.now())); assert.equal(c2['si:keep:tap'], 1); assert.equal(c2['si:keep:reg'], undefined);
      // the admin block
      assert.equal((await H.call('/rt/admin/gift/stats')).status, 401);
      const st = await (await H.call('/rt/admin/gift/stats', { headers: { 'x-admin-key': KEY } })).json(), so = st.soon;
      assert.equal(so.days, SOON_KEEP.adminDays); assert.equal(so.d1, kstDay(clock.now())); assert.equal(so.d0, addDays(so.d1, -13));
      assert.deepEqual(so.rank, ['keep', 'place', 'board', 'gift']);
      const keep = so.features.find((x) => x.f === 'keep');
      assert.deepEqual({ imp: keep.imp, tap: keep.tap, reg: keep.reg, login: keep.login, guest: keep.guest, people: keep.people }, { imp: 2, tap: 6, reg: 3, login: { imp: 1, tap: 1, reg: 1 }, guest: { imp: 1, tap: 5, reg: 2 }, people: { all: 3, login: 1, guest: 2 } });
      assert.equal(keep.conv, 1.5); assert.equal(keep.trend.length, 14); assert.deepEqual(keep.trend.at(-2), { d: d, imp: 2, tap: 5, reg: 3 }); assert.deepEqual(keep.trend.at(-1).reg, 0);
      assert.deepEqual(Object.keys(keep.src), SOON_SRC); assert.deepEqual(keep.src.soon, { imp: 0, tap: 2, reg: 1 });
      assert.equal(JSON.stringify(so).includes(G.id), false, 'the block names nobody');
      assert.deepEqual((await (await H.call('/rt/admin/gift/soon', { headers: { 'x-admin-key': KEY } })).json()).ok === undefined, true, 'no route of its own: it rides on stats');
    });
  });
  it('leaves out the operator\'s device and the e2e tool, refuses a bad body, and at budget hard sends nothing to the DO (kept: false)', async () => {
    await world(async ({ env, H, send, flush, clock }) => {
      const G = await H.guest(), d = kstDay(clock.now());
      assert.deepEqual(await (await send({ a: 'tap', f: 'gift', s: 'owner', v: VIS(3) }, { token: G.token, h: { cookie: 'kts_staff=1' } })).json(), { ok: true, kept: false, test: true });
      assert.equal((await (await send({ a: 'imp', f: ['gift'], s: 'owner' }, { h: { 'x-kts-test': '1' } })).json()).test, true);
      assert.equal((await send({ a: 'tap', f: ['gift', 'keep'], s: 'owner', v: VIS(3) })).status, 400);
      assert.equal((await send({ a: 'tap', f: 'gift', s: 'owner' })).status, 400, 'no token and no browser id: nobody to count');
      await flush(); assert.deepEqual(counts(env, d), {}); assert.equal(env.calls.filter((c) => c === 'gift.giftSeen').length, 0, 'nothing was sent');
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      const before = env.calls.filter((c) => c.startsWith('gift.')).length;
      const r = await (await send({ a: 'tap', f: 'gift', s: 'owner', v: VIS(3) }, { token: G.token })).json();
      assert.deepEqual(r, { ok: true, kept: false, busy: true });
      await flush();
      assert.equal(env.calls.filter((c) => c.startsWith('gift.')).length, before, 'no gift DO call at budget hard');
      assert.equal((await H.call('/rt/gift/soon')).status, 405);
    });
  });
  it('an account link makes the guest\'s interest the account\'s (one person); a withdrawal deletes it, the daily totals stay', async () => {
    await world(async ({ env, H, send, flush, clock, state }) => {
      const g0 = await H.guest(), G = { token: g0.token, id: 'guest:' + JSON.parse(Buffer.from(g0.token.split('.')[1], 'base64url').toString()).s }, U = await userToken(state, clock.now(), '22222222-2222-3333-4444-555555555555');
      await send({ a: 'tap', f: 'board', s: 'owner', v: VIS(4) }, { token: G.token }); await send({ a: 'tap', f: 'gift', s: 'owner', v: VIS(4) }, { token: G.token });
      const r = await send({ a: 'tap', f: 'board', s: 'more' }, { token: U.token }); await flush();
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal(people(env).length, 3);
      const link = await H.call('/rt/auth/merge', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + U.token }, body: JSON.stringify({ guest_id: G.id, guest_token: G.token }) });
      assert.equal(link.status, 200); await H.settle();
      const P = people(env); assert.equal(P.length, 2, 'board was both: one person now'); assert.ok(P.every((p) => p.lg === 1)); assert.equal(new Set(P.map((p) => p.w)).size, 1);
      await send({ a: 'tap', f: 'gift', s: 'more' }, { token: U.token }); await flush();
      assert.equal(counts(env, kstDay(clock.now()))['si:gift:reg'], 1, 'the account already had it from the guest');
      assert.equal((await H.call('/rt/auth/withdraw', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + U.token }, body: '{}' })).status, 200);
      await H.settle();
      assert.equal(people(env).length, 0, 'the account\'s interest goes');
      assert.equal(counts(env, kstDay(clock.now()))['si:board:reg'], 2, 'the totals name nobody and stay');
    });
  });
  it('impressions are summed in the isolate: 30 beacons of the four cards are one item per counter key and one row write each in one batch', async () => {
    await world(async ({ env, send, flush, clock }) => {
      const d = kstDay(clock.now()), M = env.meter('gift').do, real = M.giftSeen.bind(M), giftI = M.giftI.bind(M), got = [];
      let writes = 0;
      M.giftSeen = (items, now) => { got.push(items); writes = 0; return real(items, now); };
      M.giftI = () => { const q = giftI(); return { exec: (...a) => { const c = q.exec(...a); if (/\b(gd|gsi)\b/.test(String(a[0]))) writes += Number(c.rowsWritten) || 0; return c; } }; }; // the 출시 예정 tables' writes
      try {
        await flush(); got.length = 0;
        for (let i = 0; i < 30; i++) assert.equal((await (await send({ a: 'imp', f: ['board', 'gift', 'keep', 'place'], s: 'owner' })).json()).kept, true, 'beacon ' + i);
        assert.equal(got.length, 0, 'nothing sent before the batch is due');
        writes = 0; await flush();
        assert.equal(got.length, 1, 'one DO call');
        const si = got[0].filter((it) => it.e === 'si');
        assert.equal(si.length, 12, 'four cards x (total, login, source)');
        assert.equal(got[0].filter((it) => it.e === 'soon').length, 0, 'no item per beacon');
        assert.ok(si.every((it) => it.n === 30));
        assert.ok(writes <= 12, 'one counter row written per key: ' + writes);
        assert.equal(counts(env, d)['si:keep:imp'], 30); assert.equal(counts(env, d)['si:keep:imp:g'], 30); assert.equal(counts(env, d)['si:keep:imp@owner'], 30);
      } finally { M.giftSeen = real; M.giftI = giftI; }
    });
  });
  it('its own lower rate per network (SOON_KEEP.rateMin a minute), apart from the page beacons', async () => {
    await world(async ({ send, clock }) => {
      for (let i = 0; i < SOON_KEEP.rateMin; i++) assert.equal((await send({ a: 'imp', f: ['board'], s: 'soon' }, { ip: '3.3.3.3' })).status, 200, 'beacon ' + i);
      const r = await send({ a: 'imp', f: ['board'], s: 'soon' }, { ip: '3.3.3.3' });
      assert.equal(r.status, 429); assert.deepEqual(await r.json(), { ok: false, kept: false, code: 'rate' });
      assert.equal((await send({ a: 'imp', f: ['board'], s: 'soon' }, { ip: '3.3.3.4' })).status, 200, 'another network');
      clock.add(61000);
      assert.equal((await send({ a: 'imp', f: ['board'], s: 'soon' }, { ip: '3.3.3.3' })).status, 200, 'the next minute');
    });
  });
  it('taps: counted in the isolate, one item each for the registration; made-up browser ids register at most SOON_KEEP.regNet.d a network and day', async () => {
    await world(async ({ env, send, flush, clock }) => {
      const d = kstDay(clock.now()), N = SOON_KEEP.regNet.d + 5;
      for (let i = 0; i < N; i++) assert.equal((await (await send({ a: 'tap', f: 'gift', s: 'soon', v: VIS('c' + i) }, { ip: '4.4.4.4' })).json()).kept, true);
      await send({ a: 'tap', f: 'gift', s: 'soon', v: VIS('e') }, { ip: '4.4.4.5' });
      await flush();
      const c = counts(env, d);
      assert.equal(c['si:gift:tap'], N + 1, 'every press is a tap');
      assert.equal(c['si:gift:reg'], SOON_KEEP.regNet.d + 1, 'the cap per network, and the other network its own');
      assert.equal(people(env).filter((p) => p.f === 'gift').length, SOON_KEEP.regNet.d + 1);
      clock.add(864e5);
      await send({ a: 'tap', f: 'gift', s: 'soon', v: VIS('ae') }, { ip: '4.4.4.4' }); await flush();
      assert.equal(counts(env, kstDay(clock.now()))['si:gift:reg'], 1, 'a new day, a new allowance');
    });
  });
  it('a tap the isolate cannot hold (SEEN_CAP items waiting) answers kept: false and counts nothing, so the button goes back', async () => {
    await world(async ({ env, flush, clock }) => {
      const M = env.meter('gift').do, real = M.giftSeen.bind(M), held = [], loose = { waitUntil() {} }; // the batch is never waited for here
      const tap = async (v, ip) => (await worker.fetch(new Request('https://sq.example/rt/gift/soon', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ a: 'tap', f: 'board', s: 'soon', v }) }), env, loose)).json();
      M.giftSeen = (items, now) => new Promise((res) => held.push(() => res(real(items, now))));
      let i = 0, last = null;
      try {
        await tap(VIS('a0'), '5.0.0.1'); clock.add(31000);
        await tap(VIS('a1'), '5.0.0.1'); // the batch goes and hangs: what comes now waits in the isolate
        assert.equal(held.length, 1);
        for (; i < 1100 && (!last || last.kept); i++) last = await tap(VIS('f' + i), '5.1.' + Math.floor(i / 25) + '.1');
        assert.deepEqual(last, { ok: true, kept: false, busy: true });
        assert.ok(i >= 990 && i <= 1001, 'full at SEEN_CAP: ' + i);
        assert.equal(held.length, 1, 'still the one batch');
      } finally { M.giftSeen = real; for (const r of held) r(); }
      for (let k = 0; k < 7; k++) await flush();
      assert.equal(counts(env, kstDay(clock.now()))['si:board:tap'], i + 1, 'the refused tap was not counted');
    });
  });
  it('soonReport: every day of the range, zeros where nothing came, ranked by registrations then taps', () => {
    const r = soonReport([{ d: '2027-03-02', 'si:gift:imp': 4, 'si:gift:tap': 2, 'si:gift:reg': 1 }, { d: '2027-03-01', 'si:board:tap': 3 }], [{ f: 'gift', n: 5, a: 2 }], '2027-03-01', '2027-03-03', addDays);
    assert.equal(r.days, 3); assert.deepEqual(r.rank, ['gift', 'board', 'keep', 'place']);
    const g = r.features.find((x) => x.f === 'gift');
    assert.deepEqual(g.trend, [{ d: '2027-03-01', imp: 0, tap: 0, reg: 0 }, { d: '2027-03-02', imp: 4, tap: 2, reg: 1 }, { d: '2027-03-03', imp: 0, tap: 0, reg: 0 }]);
    assert.equal(g.conv, 0.25); assert.deepEqual(g.people, { all: 5, login: 2, guest: 3 });
    assert.equal(r.features.find((x) => x.f === 'keep').conv, 0, 'no impressions: 0, not NaN');
  });
});

describe('where the cards are (the pages\' source)', () => {
  it('the boot card has one small link to the list and no card; /discover carries the list (noindex); the plaza opens it in a sheet from the proof bar', () => {
    const html = src('index.html'), boot = /<div id="boot"[\s\S]*?\n<\/div>\n/.exec(html)[0];
    assert.equal(/soon-card|관심 있어요/.test(boot), false);
    assert.match(src('discover.html'), /<meta name="robots" content="noindex" \/>/);
    assert.match(src('discoverpage.js'), /const SOON_BOX = soonBlock\(\{ src: 'soon', id: 'soon' \}\);/);
    const ui = src('ui.js');
    assert.match(ui, /h\('button', \{ class: 'linkbtn proof-soon', type: 'button', text: '준비 중인 기능 보기', onclick: \(\) => openSoon\(\) \}\)/);
    assert.match(ui, /function openSoon\(\) \{ openSheet\(\['wish', '준비 중인 기능'\], null, \(host\) => \{ host\.append\(soonBlock\(\{ src: 'plaza', heading: false \}\)\); \}, true\); \}/);
    assert.equal((ui.match(/soonBlock\(/g) || []).length, 1, 'nowhere else in the plaza (no popup, not in the claim steps)');
    const gp = src('giftpage.js');
    assert.equal((gp.match(/soonBlock\(\{/g) || []).length, 2, 'the owner page: fresh, or under 더 보기');
  });
  it('soon.js counts an impression once per page view and feature, on screen, and sends no id but the browser one, never minting a guest', () => {
    const s = src('soon.js');
    assert.match(s, /new IntersectionObserver\(/); assert.match(s, /threshold: 0\.5/);
    assert.equal(/\/rt\/guest/.test(s), false, 'no new guest for this');
    assert.match(s, /send\(\{ a: 'tap', f: F\.id, s, v: visitor\(\) \}\)/);
    assert.equal(/email|phone|tel:/.test(s), false);
  });
  it('one impression per page view and feature: a second block, or the same block built again, sends none', async () => {
    const node = (tag) => { const n = { tag, kids: [], attrs: {}, className: '', textContent: '', append(...k) { n.kids.push(...k); }, replaceChildren(...k) { n.kids = k; }, setAttribute(k, v) { n.attrs[k] = String(v); }, getAttribute: (k) => n.attrs[k] ?? null, addEventListener() {} }; return n; };
    const sent = [], timers = [], keep = {};
    const G = { document: { createElement: node, createElementNS: (ns, t) => node(t), getElementById: () => null, head: node('head') },
      localStorage: { getItem: (k) => keep[k] ?? null, setItem: (k, v) => { keep[k] = String(v); } },
      fetch: async (url, o) => { sent.push(JSON.parse(o.body)); return { json: async () => ({ ok: true, kept: true }) }; }, setTimeout: (f) => { timers.push(f); return 1; }, IntersectionObserver: undefined };
    const before = Object.fromEntries(Object.keys(G).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    for (const [k, value] of Object.entries(G)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
    try {
      const { soonBlock } = await import('../soon.js?pv=' + Date.now());
      const run = () => { for (const f of timers.splice(0)) f(); };
      soonBlock({ src: 'owner' }); run();
      assert.deepEqual(sent.map((b) => [b.a, b.f, b.s]), [['imp', ['board', 'gift', 'keep', 'place'], 'owner']]);
      soonBlock({ src: 'owner' }); soonBlock({ src: 'more' }); run();
      assert.equal(sent.length, 1, 'built again, or another block in the same page view: nothing more');
    } finally { for (const [k, d] of Object.entries(before)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } }
  });
  it('the privacy policy says what the button keeps; its date is as it was', () => {
    const l = src('legal.js');
    assert.match(l, /준비 중인 기능\(출시 예정\) 카드에서 ‘이 기능에 관심 있어요’를 누르면/);
    assert.match(l, /연락처는 받지 않고 이 일로 알림을 보내지 않으며/);
    assert.match(l, /const EFFECTIVE = '2026년 11월 27일부터 적용합니다\(개정 2026-11-27:/);
    assert.match(l, /준비 중인 기능의 관심 버튼으로 저장하는 것을 밝힘\. 앞선 개정/);
  });
  it('the admin block is in the 🎁 tab behind the admin gate', () => {
    const a = src('admin-gift.js');
    assert.match(a, /h\('h2', \{ text: '출시 예정 관심 \(최근 14일\)' \}\)/);
    assert.match(a, /soonPaint\(st\.soon\);/);
    assert.match(src('wrangler.jsonc'), /"\/admin\*"/);
  });
});
