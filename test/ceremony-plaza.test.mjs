// 점등식 in the plaza (gift.js): the gate before the room, the ceremony's steps on one device, the photo card, the beacons, and every
// way the hidden HUD comes back. A small fake document (no browser) and a world that only records what it is asked to do; the clock is
// moved by hand (Date.now, which live.js nowMs reads) and the 250 ms tick is run by hand. The pure rules are test/ceremony.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CER, CER_TEXT, windowFor, cerPinMs } from '../giftrules.js';

const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const KST = (s) => Date.parse(s + '+09:00');
const S = KST('2026-12-25T18:00:00');
const W = windowFor('2026-12-25', 18, KST('2026-12-25T08:00:00'));
// The public view GET /rt/gift/<id> answers with (to 민지, from 지수, 18:00 on the 25th).
const board = (o = {}) => ({ id: 'abcd1234', to: '민지', from: '지수', occ: 'bday', msg: '비밀 문구 🤫', th: 'party', day: '2026-12-25', a: W.a, b: W.b, scr: 'STREET_31', phase: 'day', n: 0, ...o });

let LOADS = 0;
// The page: just what gift.js touches. P.at is the device clock (Date.now); P.tick() runs the intervals once, P.timers() the timeouts.
function fakeDom({ search = '?gb=abcd1234&cer=1', at = S - 5 * 60000, host = 'studio.wishboard.workers.dev', gift = board(), hard = false, store = {}, hidden = false, share = null, date = '', never = false } = {}) {
  const sent = [], timeouts = [], ticks = [], winOn = {}, docOn = {}, beacons = [], shared = [], copied = [];
  const P = { sent, timeouts, ticks, winOn, docOn, beacons, shared, copied, store, replaced: null, at };
  const text = (v) => ({ nodeType: 3, textContent: String(v), parent: null });
  const el = (tag) => {
    const n = { tag: String(tag).toLowerCase(), nodeType: 1, kids: [], attrs: {}, on: {}, style: {}, className: '', parent: null, hidden: false, id: '' };
    const adopt = (c) => { const k = c && c.nodeType ? c : text(c); if (k.parent) k.parent.kids = k.parent.kids.filter((x) => x !== k); k.parent = n; return k; };
    const cls = new Set();
    Object.assign(n, {
      append(...cs) { for (const c of cs) n.kids.push(adopt(c)); }, prepend(...cs) { n.kids.unshift(...cs.map(adopt)); },
      after(c) { const i = n.parent.kids.indexOf(n); if (c.parent) c.parent.kids = c.parent.kids.filter((x) => x !== c); c.parent = n.parent; n.parent.kids.splice(i + 1, 0, c); },
      replaceChildren(...cs) { for (const k of n.kids) k.parent = null; n.kids = []; n.append(...cs); },
      remove() { if (n.parent) n.parent.kids = n.parent.kids.filter((x) => x !== n); n.parent = null; },
      contains(o) { for (let x = o; x; x = x.parent) if (x === n) return true; return false; },
      setAttribute(k, v) { n.attrs[k] = String(v); if (k === 'id') n.id = String(v); }, getAttribute: (k) => n.attrs[k] ?? null,
      addEventListener(t, f) { (n.on[t] ||= []).push(f); }, removeEventListener() {}, focus() { doc.activeElement = n; }, click() { n.clicked = (n.clicked || 0) + 1; },
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => { if (on ?? !cls.has(c)) cls.add(c); else cls.delete(c); return cls.has(c); }, contains: (c) => cls.has(c) },
    });
    Object.defineProperty(n, 'textContent', { get: () => n.kids.map((k) => k.textContent).join(''), set(v) { n.replaceChildren(); if (v != null && v !== '') n.append(String(v)); } });
    Object.defineProperty(n, 'isConnected', { get: () => { for (let x = n; x; x = x.parent) if (x === doc.body) return true; return false; } });
    return n;
  };
  const doc = { createElement: el, createElementNS: (ns, t) => el(t), getElementById: () => null, querySelector: () => null, head: el('head'), body: el('body'), activeElement: null, hidden, addEventListener(t, f) { (docOn[t] ||= []).push(f); }, removeEventListener() {} };
  const u = new URL('https://' + host + '/' + search);
  const loc = { pathname: '/', search: u.search, hash: '', hostname: host, origin: 'https://' + host, get href() { return loc.origin + loc.pathname + loc.search; }, set href(v) { loc.went = String(v); }, replace(v) { P.replaced = String(v); } };
  const hist = { state: null, replaceState(s, t, url) { const x = new URL(String(url), loc.origin); loc.pathname = x.pathname; loc.search = x.search; } };
  const real = Date.now;
  const globals = {
    document: doc, location: loc, history: hist,
    window: { addEventListener(t, f) { (winOn[t] ||= []).push(f); }, removeEventListener() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); } },
    sessionStorage: (() => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem(k, v) { m[k] = String(v); } }; })(),
    navigator: { userAgent: 'test', sendBeacon: (url, body) => { beacons.push({ url, body }); return true; }, clipboard: { async writeText(t) { copied.push(t); } }, share: share ? async (d) => { shared.push(d); } : undefined, canShare: share === 'files' ? () => true : undefined, serviceWorker: { addEventListener() {} } },
    fetch: async (url, opt = {}) => {
      sent.push({ url: String(url), method: opt.method || 'GET' });
      if (never && /^\/rt\/gift\/[0-9a-z]{8}$/.test(String(url))) return new Promise(() => {}); // no answer at all
      if (/^\/rt\/gift\/[0-9a-z]{8}$/.test(String(url))) { const body = gift ? { ok: true, gift, own: false, ...(hard ? { hard: true } : {}) } : { ok: false }; return { ok: !!gift, status: gift ? 200 : 404, headers: { get: (k) => (k === 'date' ? date : null) }, json: async () => body }; }
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ ok: false }) };
    },
    setInterval: (f) => { ticks.push(f); return ticks.length; }, clearInterval: (i) => { if (i) ticks[i - 1] = null; },
    setTimeout: (f, ms) => { timeouts.push({ f, ms }); return timeouts.length; }, clearTimeout() {},
    requestAnimationFrame: () => 0,
  };
  const before = Object.fromEntries(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  Date.now = () => P.at;
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const walk = (n, out = []) => { if (n.nodeType === 1) { out.push(n); for (const k of n.kids) walk(k, out); } return out; };
  Object.assign(P, {
    doc, loc, settle,
    done() { Date.now = real; for (const [k, d] of Object.entries(before)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } },
    async load() { const m = await import('../gift.js?cer=' + (++LOADS)); await settle(); return m; },
    tick() { for (const f of ticks) f?.(); },
    /** Move the clock to ms after the start, ticking every 250 ms on the way (a visible tab). */
    run(to, step = 250) { for (let t = P.at; t < S + to; t += step) { P.at = t; P.tick(); } P.at = S + to; P.tick(); },
    async timers(max = 1e9) { for (const t of timeouts.splice(0).filter((x) => x.ms <= max)) await t.f(); await settle(); },
    hudHidden: () => doc.body.classList.contains('gift-cer'),
    digit: () => walk(doc.body).find((n) => n.id === 'kts-cer-n')?.textContent ?? '',
    card: () => walk(doc.body).find((n) => n.id === 'kts-cer-card') || null,
    btn: (re, root = doc.body) => walk(root).find((n) => (n.tag === 'button' || n.tag === 'a') && re.test(n.textContent || n.attrs['aria-label'] || '')) || null,
    async press(n) { assert.ok(n, 'the button is there'); for (const f of n.on.click || []) await f({ preventDefault() {} }); await settle(); },
  });
  return P;
}
// What a sendBeacon body (a Blob) says.
async function events(P) { const out = []; for (const b of P.beacons) out.push(JSON.parse(await b.body.text()).e); return out; }

// The world as gift.js sees it: every call recorded; options for the paths a test walks.
function fakeWorld(P, { slot = 'STREET_31', emote = [true], driving = false, walking = false, pose = true, player = null } = {}) {
  const calls = [], W = {
    calls, driving, walk: walking, gone: false, emote: [...emote], throwOn: '',
    pinGift: (g, ms, o) => { calls.push(['pin', g.id, ms, o?.cer || 0]); return slot; },
    goToSlot: (s, o) => { calls.push(['go', s, o?.spread != null]); return { x: 10, z: 20 }; },
    focusSlot: (s, o) => { calls.push(['focus', s, Math.round(o?.hold || 0)]); return {}; },
    cerPrep: (s) => { calls.push(['prep', s]); return {}; },
    cerPose: (s) => { calls.push(['pose', s, P.at - S]); return pose ? {} : false; },
    cerEnd: () => calls.push(['end']),
    capture: (o) => { calls.push(['capture', P.at - S, o?.me === true, o?.band || '']); return new Blob(['jpeg'], { type: 'image/jpeg' }); },
    cheerAt: (s) => { if (W.throwOn === 'cheer') throw new Error('boom'); calls.push(['cheer', s, P.at - S]); },
    playEmote: (id) => { const ok = W.emote.length ? W.emote.shift() : true; calls.push(['emote', id, ok]); return ok; },
    isDriving: () => W.driving, walking: () => W.walk,
    getPlayer: () => player || { x: 10, z: 20 },
    giftSlot: () => (W.gone ? '' : slot),
    setGifts() {}, setInputEnabled() {},
  };
  return W;
}
async function plaza(o = {}) {
  const P = fakeDom(o);
  P.notes = [];
  P.world = fakeWorld(P, o.world || {});
  P.layer = [];
  P.busy = false;
  P.down = false;
  const { mountGift, cerGate } = await P.load();
  P.cerGate = cerGate;
  const ui = { note: (t, k, fn, opts) => { P.notes.push({ t, k, fn, ms: opts?.ms }); return {}; }, busy: () => P.busy, layer: (el, close) => P.layer.push(el ? ['on', el.id] : ['off']) };
  P.gift = mountGift({ world: P.world, ui, whenBuilt: (f) => f(), introDone() {}, budgetDown: () => P.down });
  P.base = P.ticks.filter(Boolean).length; // the intervals that were there before any ceremony (the 🎁 button's place)
  return P;
}
const kinds = (P) => P.world.calls.map((c) => c[0]);
const of = (P, k) => P.world.calls.filter((c) => c[0] === k);

describe('the gate: /?gb=<id>&cer=1 asks for the board before the room is joined', () => {
  it('too early: back to the page with ?cer=early, nothing pinned, the hold never lets the room in', async () => {
    const P = await plaza({ at: KST('2026-12-25T17:40:00') });
    try {
      assert.equal(P.sent.filter((s) => s.url === '/rt/gift/abcd1234').length, 1, 'read once, at import');
      let held = false; P.gift.cerHold().then(() => { held = true; });
      assert.equal(P.gift.arrive(), true);
      await P.settle();
      assert.equal(P.replaced, '/g/abcd1234?cer=early');
      assert.equal(held, false, 'net.join waits for ever (the page is going away)');
      assert.deepEqual(P.world.calls, []);
      assert.equal(P.sent.filter((s) => s.url === '/rt/gift/abcd1234').length, 1, 'the same read for arrive');
    } finally { P.done(); }
  });
  it('budget hard inside the window: back with ?cer=busy; a Worker without `hard` lets it in', async () => {
    let P = await plaza({ at: S - 5 * 60000, hard: true });
    try { P.gift.arrive(); await P.settle(); assert.equal(P.replaced, '/g/abcd1234?cer=busy'); assert.deepEqual(P.world.calls, []); } finally { P.done(); }
    P = await plaza({ at: S - 5 * 60000 });
    try { assert.deepEqual(await P.gift.cerHold(), { go: true, g: board(), start: S }); assert.equal(P.replaced, null); } finally { P.done(); }
  });
  it('no ceremony now (past the late window, a "지금" board, gone, no answer): the ordinary ?gb= visit', async () => {
    let P = await plaza({ at: S + CER.late + 1000 });
    try { assert.deepEqual(await P.gift.cerHold(), { go: false }); P.gift.arrive(); await P.settle(); assert.equal(of(P, 'pin')[0]?.[2], 60000, 'land(): pinned for a minute'); } finally { P.done(); }
    P = await plaza({ at: S - 60000, gift: board({ a: S + 600000 }) });
    try { assert.deepEqual(await P.gift.cerHold(), { go: false }); } finally { P.done(); }
    P = await plaza({ at: S - 60000, gift: null });
    try { assert.deepEqual(await P.gift.cerHold(), { go: false }); } finally { P.done(); }
  });
  it('the server\'s clock decides: a device 7 minutes slow is still let in, by the Date header', async () => {
    const at = S - 13 * 60000; // the device thinks it is 17:47; the server says 17:54
    const P = await plaza({ at, date: new Date(S - 6 * 60000).toUTCString() });
    try { assert.equal((await P.gift.cerHold()).go, true); assert.equal(P.replaced, null); } finally { P.done(); }
  });
  it('no answer: the 4 s start when the visitor waits (enter, the arrival), not at the read; then the ordinary visit', async () => {
    const P = await plaza({ at: S - 60000, never: true });
    try {
      assert.equal(P.timeouts.filter((t) => t.ms === 4000).length, 0, 'not armed by the read at import');
      let r = null; P.gift.cerHold().then((v) => { r = v; });
      P.gift.arrive();
      assert.equal(P.timeouts.filter((t) => t.ms === 4000).length, 1, 'armed once');
      await P.timers(4000);
      assert.deepEqual(r, { go: false });
      assert.equal(of(P, 'pin').length, 0, 'no ceremony pin');
      assert.equal(P.sent.filter((s) => s.url === '/rt/gift/abcd1234').length, 2, 'the ordinary visit asks again (land)');
      assert.equal(P.replaced, null);
    } finally { P.done(); }
  });
  it('without cer=1 nothing is read before the room and ?gb= is today\'s', async () => {
    const P = await plaza({ search: '?gb=abcd1234', at: S - 60000 });
    try {
      assert.equal(P.sent.length, 0);
      assert.deepEqual(await P.gift.cerHold(), { go: false });
      assert.deepEqual(await P.cerGate(), { go: false });
    } finally { P.done(); }
  });
  it('the localhost seam: &cerin=75 on a local host starts any board 75 s from now; on the live host it does nothing', async () => {
    const at = KST('2026-12-20T12:00:00');
    let P = await plaza({ host: 'localhost', search: '?gb=abcd1234&cer=1&cerin=75', at });
    try { const r = await P.gift.cerHold(); assert.equal(r.go, true); assert.equal(r.start, at + 75000); } finally { P.done(); }
    P = await plaza({ search: '?gb=abcd1234&cer=1&cerin=75', at });
    try { P.gift.arrive(); await P.settle(); assert.equal(P.replaced, '/g/abcd1234?cer=early', 'the real start (18:00 on the 25th) is days away'); } finally { P.done(); }
  });
});

describe('the ceremony, step by step on one device', () => {
  it('arrives 5 minutes early: the teaser pin, the spread spot, the camera, the toast, one beacon', async () => {
    const P = await plaza({ at: S - 5 * 60000 });
    try {
      P.gift.arrive(); await P.settle();
      assert.deepEqual(P.world.calls.slice(0, 3), [['pin', 'abcd1234', cerPinMs(S, S - 5 * 60000), S], ['go', 'STREET_31', true], ['focus', 'STREET_31', 3500]]);
      assert.deepEqual(P.notes.map((n) => n.t), ['🎆 민지님 선물 전광판 점등식 · 18:00에 켜져요']);
      assert.deepEqual(await events(P), ['cer']);
      assert.equal(P.loc.search, '', 'the link is used up (gb, cer, cerin)');
      await P.timers(1200); assert.deepEqual(of(P, 'prep'), [['prep', 'STREET_31']], 'the photo pose worked out ahead of time');
      assert.equal(P.hudHidden(), false, 'the HUD is up while waiting');
    } finally { P.done(); }
    // A second arrival the same day sends no second beacon (the page's kts_gseen rule).
    const store = {};
    for (let i = 0; i < 2; i++) { const Q = await plaza({ at: S - 4 * 60000, store }); try { Q.gift.arrive(); await Q.settle(); assert.deepEqual(await events(Q), i ? [] : ['cer']); } finally { Q.done(); } }
  });
  it('counts 10..1 with the HUD hidden, lights, cheers once (a refused emote is tried again), six rounds, the pose, the photo, the card', async () => {
    const P = await plaza({ at: S - 60000, world: { emote: [false, true] } });
    try {
      P.gift.arrive(); await P.settle();
      P.run(-10001); assert.equal(P.digit(), ''); assert.equal(P.hudHidden(), false);
      P.run(-10000); assert.equal(P.digit(), '10'); assert.equal(P.hudHidden(), true);
      assert.deepEqual(of(P, 'focus').at(-1), ['focus', 'STREET_31', CER.count + CER.pose], 'the camera on the board until +6.5 s');
      P.run(-500); assert.equal(P.digit(), '1');
      P.run(0); assert.equal(P.digit(), '', 'the number goes at the start');
      P.run(12000);
      assert.deepEqual(of(P, 'emote'), [['emote', 3, false], ['emote', 3, true]], 'one cheer: the first try was refused by the cooldown');
      const rounds = of(P, 'cheer').map((c) => c[2]);
      assert.equal(rounds.length, 6); rounds.forEach((t, k) => assert.ok(t >= k * CER.roundMs && t < k * CER.roundMs + 250, 'round ' + k + ' at ' + t)); // on the first tick of its moment
      assert.deepEqual(of(P, 'pose'), [['pose', 'STREET_31', CER.pose]]);
      assert.deepEqual(of(P, 'capture'), [['capture', CER.shot, true, 'To. 민지 · 2026.12.25 · WISH BOARD 가상 광장']]);
      assert.ok(kinds(P).indexOf('end') > kinds(P).indexOf('capture'), 'the pose ends after the shot');
      assert.equal(P.hudHidden(), false, 'the HUD is back for the card');
      const card = P.card(); assert.ok(card, 'the photo card');
      assert.deepEqual(P.layer.at(-1), ['on', 'kts-cer-card'], 'the one modal layer');
      assert.equal(card.attrs.role, 'dialog');
      assert.ok(P.btn(/^📸 단체 사진이 나왔어요$/) === null && card.textContent.includes(CER_TEXT.shotHead));
      for (const re of [/^사진 저장$/, /^공유하기$/, /^받는 사람 페이지로$/, /^닫기$/]) assert.ok(P.btn(re, card), String(re));
      assert.equal(P.btn(/^받는 사람 페이지로$/, card).href, '/g/abcd1234');
      assert.equal(P.btn(/^사진 저장$/, card).className, 'b gold');
      assert.equal(P.notes.some((n) => n.t === CER_TEXT.shotTake || n.t === CER_TEXT.shotReady), false, 'no notice: the card opened by itself');
    } finally { P.done(); }
  });
  it('the card: 사진 저장 sends cershot once; 공유하기 shares the file with the words and the link; ✕ closes the layer', async () => {
    const P = await plaza({ at: S - 30000, share: 'files' });
    try {
      P.gift.arrive(); await P.settle(); P.run(9000);
      const card = P.card();
      await P.press(P.btn(/^공유하기$/, card));
      assert.equal(P.shared.length, 1);
      assert.equal(P.shared[0].text, '🎆 민지님 선물 전광판 점등식에서 · WISH BOARD 가상 광장');
      assert.equal(P.shared[0].url, 'https://studio.wishboard.workers.dev/g/abcd1234');
      assert.equal(P.shared[0].files[0].name, 'wishboard-abcd1234.jpg');
      await P.press(P.btn(/^공유하기$/, card));
      assert.deepEqual(await events(P), ['cer', 'cershot'], 'once per board, event and day');
      await P.press(P.btn(/^닫기$/, card));
      assert.equal(P.card(), null); assert.deepEqual(P.layer.at(-1), ['off']);
    } finally { P.done(); }
    // No file sharing and no share sheet: the link is copied.
    const Q = await plaza({ at: S - 30000 });
    try { Q.gift.arrive(); await Q.settle(); Q.run(9000); await Q.press(Q.btn(/^공유하기$/, Q.card())); assert.deepEqual(Q.copied, ['🎆 민지님 선물 전광판 점등식에서 · WISH BOARD 가상 광장 https://studio.wishboard.workers.dev/g/abcd1234']); assert.deepEqual(await events(Q), ['cer', 'cershot']); } finally { Q.done(); }
  });
  it('a sheet or a layer open at the shot: the photo is still taken, a notice opens the card later', async () => {
    const P = await plaza({ at: S - 30000 });
    try {
      P.gift.arrive(); await P.settle();
      P.run(-10000); assert.equal(P.hudHidden(), true);
      P.busy = true; P.run(-9000); assert.equal(P.hudHidden(), false, 'a sheet opened by itself: the HUD is back');
      P.run(CER.shot);
      assert.equal(of(P, 'capture').length, 1, 'taken');
      assert.equal(P.card(), null, 'no card over the sheet');
      const n = P.notes.find((x) => x.t === CER_TEXT.shotReady);
      assert.ok(n && n.fn && n.ms >= 60000, 'a tappable notice that waits');
      P.busy = false; n.fn();
      assert.ok(P.card());
    } finally { P.done(); }
  });
  it('a late arrival (+30 s): the lit card, one round, no countdown, no photo by itself, the 📸 notice while lit', async () => {
    const P = await plaza({ at: S + 30000 });
    try {
      P.gift.arrive(); await P.settle();
      assert.deepEqual(P.notes[0].t, '🎆 민지님 선물 전광판이 방금 켜졌어요!');
      P.run(60000);
      assert.equal(P.digit(), ''); assert.equal(P.hudHidden(), false);
      assert.equal(of(P, 'cheer').length, 1);
      assert.equal(of(P, 'emote').length, 0, 'no cheer after the first 5 s');
      assert.equal(of(P, 'capture').length, 0);
      const n = P.notes.find((x) => x.t === CER_TEXT.shotTake);
      assert.ok(n?.fn, 'offered');
      assert.ok(n.ms >= CER.late - 30000 - 1000 && n.ms <= CER.late - 30000 + 1000, 'until the lit minutes end: ' + n.ms);
      n.fn();
      assert.equal(of(P, 'pose').length, 1);
      await P.timers(); // the shot 1.5 s after the pose
      assert.equal(of(P, 'capture').length, 1); assert.ok(P.card());
    } finally { P.done(); }
  });
  it('a tab hidden from -20 s to +3.7 s: no countdown, rounds 3 to 5 only, the photo on time', async () => {
    const P = await plaza({ at: S - 60000 });
    try {
      P.gift.arrive(); await P.settle();
      P.run(-20000);
      P.at = S + 3700; P.doc.hidden = false; for (const f of P.docOn.visibilitychange || []) f();
      assert.equal(P.digit(), '');
      P.run(12000);
      const rounds = of(P, 'cheer').map((c) => c[2]);
      assert.equal(rounds.length, 3, 'rounds 3, 4 and 5'); assert.equal(rounds[0], 3700); assert.ok(rounds[1] >= 4800 && rounds[1] < 5050 && rounds[2] >= 6000 && rounds[2] < 6250, String(rounds));
      const shots = of(P, 'capture').map((c) => c[1]);
      assert.ok(shots.length === 1 && shots[0] >= CER.shot && shots[0] < CER.shot + 250, 'the photo on the first tick from +8 s: ' + shots);
    } finally { P.done(); }
  });
  it('budget hard learned after arriving: back to the page before the start, stays after it', async () => {
    let P = await plaza({ at: S - 120000 });
    try { P.gift.arrive(); await P.settle(); P.down = true; P.run(-60000); assert.equal(P.replaced, '/g/abcd1234?cer=busy'); assert.equal(P.hudHidden(), false); } finally { P.done(); }
    P = await plaza({ at: S - 60000 });
    try { P.gift.arrive(); await P.settle(); P.run(5000); P.down = true; P.run(10000); assert.equal(P.replaced, null); assert.equal(of(P, 'capture').length, 1); } finally { P.done(); }
  });
  it('the embedded recipient page\'s button ({ t: gift, act: cer }) closes the frame and runs the gate for that id', async () => {
    const P = await plaza({ search: '', at: S - 60000 });
    try {
      for (const f of P.winOn.message) f({ origin: P.loc.origin, data: { t: 'gift', act: 'cer', id: 'abcd1234' } });
      await P.settle();
      assert.equal(P.sent.filter((s) => s.url === '/rt/gift/abcd1234').length, 1);
      assert.equal(of(P, 'pin')[0][3], S, 'the ceremony pin');
      for (const f of P.winOn.message) f({ origin: 'https://evil.example', data: { t: 'gift', act: 'cer', id: 'abcd1234' } });
      await P.settle();
      assert.equal(of(P, 'pin').length, 1, 'only this site\'s own page');
    } finally { P.done(); }
  });
  it('at +2 min the tick stops and the HUD class is gone', async () => {
    const P = await plaza({ at: S - 60000 });
    try {
      P.gift.arrive(); await P.settle();
      P.run(CER.late + 1000);
      assert.equal(P.ticks.filter(Boolean).length, P.base, 'the interval is cleared');
      assert.equal(P.hudHidden(), false);
    } finally { P.done(); }
  });
});

describe('the photo card: save; the gather notice; the countdown camera', () => {
  it('사진 저장 saves wishboard-<id>.jpg and sends cershot once', async () => {
    const P = await plaza({ at: S - 30000 });
    try {
      P.gift.arrive(); await P.settle(); P.run(9000);
      const save = P.btn(/^사진 저장$/, P.card());
      await P.press(save); await P.press(save);
      assert.deepEqual(await events(P), ['cer', 'cershot']);
      assert.ok(P.card().textContent.includes('사진을 저장했어요.'));
    } finally { P.done(); }
  });
  it('at -30 s a device far from the board is asked back (tap: to the front again); a device near it is not', async () => {
    let P = await plaza({ at: S - 60000, world: { player: { x: 60, z: 20 } } });
    try {
      P.gift.arrive(); await P.settle(); P.run(-30001);
      assert.equal(P.notes.some((n) => n.t === CER_TEXT.gather), false, 'not before -30 s');
      P.run(-29000);
      const n = P.notes.filter((x) => x.t === CER_TEXT.gather);
      assert.equal(n.length, 1); assert.ok(n[0].fn);
      const go = of(P, 'go').length; n[0].fn(); assert.equal(of(P, 'go').length, go + 1);
      P.run(-1000); assert.equal(P.notes.filter((x) => x.t === CER_TEXT.gather).length, 1, 'once');
    } finally { P.done(); }
    P = await plaza({ at: S - 60000 });
    try { P.gift.arrive(); await P.settle(); P.run(-20000); assert.equal(P.notes.some((n) => n.t === CER_TEXT.gather), false); } finally { P.done(); }
  });
  it('the camera in the countdown: on the board unless the player is driving or walking', async () => {
    for (const [driving, walking, want] of [[false, false, true], [true, false, false], [false, true, false], [true, true, false]]) {
      const P = await plaza({ at: S - 30000, world: { driving, walking } });
      try { P.gift.arrive(); await P.settle(); const n = of(P, 'focus').length; P.run(-10000); assert.equal(of(P, 'focus').length - n, want ? 1 : 0, JSON.stringify({ driving, walking })); } finally { P.done(); }
    }
  });
});

describe('every way out of the countdown brings the HUD back', () => {
  // Each starts with the HUD hidden in the countdown.
  async function counting(o) { const P = await plaza({ at: S - 30000, ...o }); P.gift.arrive(); await P.settle(); P.run(-5000); assert.equal(P.hudHidden(), true); return P; }
  it('the tick reaching the photo', async () => { const P = await counting(); try { P.run(CER.shot); assert.equal(P.hudHidden(), false); } finally { P.done(); } });
  it('the photo\'s moment passing unseen (+12 s)', async () => { const P = await counting({ world: { pose: false } }); try { P.at = S + CER.shot + CER.shotSlack; P.tick(); assert.equal(P.hudHidden(), false); } finally { P.done(); } });
  it('the tab hidden for minutes', async () => { const P = await counting(); try { P.doc.hidden = true; P.at = S + 5 * 60000; P.doc.hidden = false; for (const f of P.docOn.visibilitychange) f(); assert.equal(P.hudHidden(), false); assert.equal(P.ticks.filter(Boolean).length, P.base); } finally { P.done(); } });
  it('coming back to the page (back/forward cache)', async () => { const P = await counting(); try { P.at = S + 3 * 60000; for (const f of P.winOn.pageshow) f({ persisted: true }); assert.equal(P.hudHidden(), false); } finally { P.done(); } });
  it('an exception in a step', async () => { const P = await counting(); try { P.world.throwOn = 'cheer'; P.run(100); assert.equal(P.hudHidden(), false); assert.equal(P.ticks.filter(Boolean).length, P.base, 'the ceremony ended'); } finally { P.done(); } });
  it('the board leaving its screen', async () => { const P = await counting(); try { P.world.gone = true; P.tick(); assert.equal(P.hudHidden(), false); assert.equal(P.digit(), ''); } finally { P.done(); } });
  it('getting into a taxi', async () => { const P = await counting(); try { P.world.driving = true; P.tick(); assert.equal(P.hudHidden(), false); } finally { P.done(); } });
  it('a sheet opening by itself (ui.busy, and the CSS leaves the HUD to body.has-sheet at once)', async () => {
    const P = await counting();
    try { P.busy = true; P.tick(); assert.equal(P.hudHidden(), false); } finally { P.done(); }
    assert.match(src('gift.js'), /body\.gift-cer:not\(\.has-sheet\) #ui\{visibility:hidden\}/);
  });
  it('budget hard sending the visitor back', async () => { const P = await counting(); try { P.down = true; P.tick(); assert.equal(P.hudHidden(), false); } finally { P.done(); } });
});

describe('when the HUD hides: the whole table', () => {
  // phase × sheet or layer open × driving × here before the start: hidden only in [start - 10 s, the photo) for a device that waited,
  // with nothing open and not driving.
  const rows = [];
  for (const at of [-60000, -10000, -1, 0, 5000, CER.shot - 1, CER.shot + 1, CER.shot + CER.shotSlack + 1])
    for (const busy of [false, true]) for (const driving of [false, true]) for (const late of [false, true]) rows.push({ at, busy, driving, late });
  it(`${rows.length} rows`, async () => {
    for (const r of rows) {
      const P = await plaza({ at: r.late ? S + 1 : S - 120000 });
      try {
        P.gift.arrive(); await P.settle();
        if (!r.late) P.run(Math.min(r.at, -10001));
        P.busy = r.busy; P.world.driving = r.driving;
        if (r.at >= (r.late ? 1 : -10001)) P.run(r.at); else P.tick();
        const want = !r.late && !r.busy && !r.driving && r.at >= -CER.count && r.at < CER.shot;
        assert.equal(P.hudHidden(), want, JSON.stringify(r));
      } finally { P.done(); }
    }
  });
});

describe('the photo card and the overlay follow the HUD rules (sheet)', () => {
  const css = /const CSS = `([\s\S]*?)`;/.exec(src('gift.js'))[1];
  it('the number takes no pointer, is min(42vw, 42vh), and does not move with reduced motion', () => {
    assert.match(css, /#kts-cer-n\{position:fixed;inset:0;[^}]*pointer-events:none;font:900 min\(42vw,42vh\)\/1/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\{#kts-cer-n\.a,#kts-cer-n\.b\{animation:none\}\}/);
  });
  it('the card\'s buttons are 48 px tall, its ✕ 44 px, no text under 12 px', () => {
    assert.match(css, /#kts-cer-card \.b\{display:flex;width:100%;min-height:48px;/);
    assert.match(css, /#kts-cer-card \.x\{position:absolute;right:12px;top:12px;width:44px;height:44px;/);
    for (const m of css.matchAll(/#kts-cer-[^{]*\{[^}]*font-size:(\d+)px/g)) assert.ok(Number(m[1]) >= 12, m[0]);
  });
  it('nothing new goes to the room and nothing is uploaded', () => {
    const g = src('gift.js'), cer = g.slice(g.indexOf('// ---- 점등식: the ceremony on this device'), g.indexOf('// ?gb=<id> (and &rec=1')).replace(/\/\/.*$/gm, ''); // code, not comments
    assert.equal(/publishShot|net\.|sendEmoji|\.send\(|\/rt\/(?!gift\/)|upload\(/.test(cer), false);
    assert.match(cer, /world\.playEmote\?\.\(3\)/);
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML/.test(g), false);
  });
});

describe('the entry waits for the ceremony gate (main.js, ui.js)', () => {
  const main = src('main.js');
  it('enter() asks gift.js before joining the room; the boot card is not changed', () => {
    const a = main.indexOf('async function enter({ nick, color, species }) {'), enter = main.slice(a, main.indexOf('\n}\n', a));
    const hold = enter.indexOf('await giftUi?.cerHold?.();'), join = enter.indexOf("await net.join('square', world.netState());");
    assert.ok(hold > 0 && join > hold, 'the gate before net.join');
  });
  it('mountGift hears about budget hard from the room and the gate', () => {
    assert.match(main, /giftUi = mountGift\(\{ world, ui, whenBuilt, introDone: \(\) => introDone\(\), budgetDown: \(\) => !!\(net\.budgetDown \|\| net\.gateDown\) \}\);/);
  });
  it('a ceremony link is a deep link: no welcome board, no intro (main.js DEEP_LINK reads ?gb=)', () => {
    const a = main.indexOf('const DEEP_LINK = (() => {'), deep = main.slice(a, main.indexOf('})();', a));
    assert.match(deep, /'gb'/);
    assert.ok(main.indexOf('if (giftUi?.arrive()) return;') < main.indexOf('world?.playIntro();'));
  });
  it('ui.busy(): a sheet or a layer is open', () => {
    assert.match(src('ui.js'), /\n    busy: \(\) => sheets\.length > 0 \|\| !!ext,\n/);
  });
});
