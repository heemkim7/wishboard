// 점등식: the review's findings (2026-11-25) that need a harness of their own. The recipient page (giftpage.js) turning by itself at the
// lighting and at 00:00 of the day without losing what a friend was typing in the 롤링페이퍼; the public view saying whether a board was
// scheduled (giftView fx) so a "지금" board made just after a start hour is no ceremony; net.js telling budget hard from a connection that
// only fails (budgetHard); ts3d/screens.js moving a ceremony pin off a screen a holder lit. The plaza side of the same fixes is in
// test/ceremony-plaza.test.mjs, the photo's in test/ceremony-world.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { windowFor, giftView, cerStart } from '../giftrules.js';

register(new URL('./nine-three-hook.mjs', import.meta.url)); // 'three' -> the vendored build, so ts3d/screens.js loads in Node
const KST = (s) => Date.parse(s + '+09:00');

// ---- the recipient page in a small fake document (the harness of test/gift.test.mjs, with scrolling and focus recorded) ----------------
let LOADS = 0;
function fakeDom({ path = '/gift', search = '', data = null, store = {}, at = 0 } = {}) {
  const ticks = [], scrolls = [], P = { store, scrolls, skew: at ? at - Date.now() : 0 };
  const ink = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => ink), set: (t, k, v) => { t[k] = v; return true; } });
  const text = (v) => ({ nodeType: 3, textContent: String(v), parent: null });
  const REFLECT = new Set(['hidden', 'disabled', 'href', 'id', 'type', 'src', 'title', 'placeholder']);
  const el = (tag) => {
    const n = { tag: String(tag).toLowerCase(), nodeType: 1, kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', parent: null, hidden: false, disabled: false, width: 0, height: 0 };
    const adopt = (c) => { const k = c && c.nodeType ? c : text(c); if (k.parent) k.parent.kids = k.parent.kids.filter((x) => x !== k); k.parent = n; return k; };
    // Taking a node out of the page takes the focus with it, as a browser does (the keyboard of a phone goes down).
    const blur = (k) => { for (let x = doc.activeElement; x; x = x.parent) if (x === k) { doc.activeElement = doc.body; return; } };
    Object.assign(n, {
      append(...cs) { for (const c of cs) n.kids.push(adopt(c)); }, prepend(...cs) { n.kids.unshift(...cs.map(adopt)); },
      after(c) { const i = n.parent.kids.indexOf(n); const k = c; if (k.parent) k.parent.kids = k.parent.kids.filter((x) => x !== k); k.parent = n.parent; n.parent.kids.splice(i + 1, 0, k); },
      replaceChildren(...cs) { for (const k of n.kids) { blur(k); k.parent = null; } n.kids = []; n.append(...cs); },
      remove() { blur(n); if (n.parent) n.parent.kids = n.parent.kids.filter((x) => x !== n); n.parent = null; },
      contains(o) { for (let x = o; x; x = x.parent) if (x === n) return true; return false; },
      setAttribute(k, v) { n.attrs[k] = String(v); if (REFLECT.has(k)) n[k] = k === 'hidden' || k === 'disabled' ? true : String(v); if (k === 'width' || k === 'height') n[k] = Number(v); },
      getAttribute: (k) => n.attrs[k] ?? null, addEventListener(t, f) { (n.on[t] ||= []).push(f); }, removeEventListener() {},
      focus() { doc.activeElement = n; }, matches: () => false, getContext: () => ink, canPlayType: () => '', play: () => Promise.resolve(), pause() {},
    });
    Object.defineProperty(n, 'textContent', { get: () => n.kids.map((k) => k.textContent).join(''), set(v) { n.replaceChildren(); if (v != null && v !== '') n.append(String(v)); } });
    Object.defineProperty(n, 'isConnected', { get: () => { for (let x = n; x; x = x.parent) if (x === app || x === doc.body) return true; return false; } });
    return n;
  };
  const app = el('main'), dataTag = data ? { textContent: JSON.stringify(data) } : null;
  const doc = { getElementById: (id) => (id === 'app' ? app : id === 'gift-data' ? dataTag : null), createElement: el, createElementNS: (ns, tag) => el(tag), createTextNode: text, querySelector: () => null, // createElementNS: the pages' line icons (uiicons.js)
    documentElement: { classList: { add() {} } }, head: el('head'), body: el('body'), activeElement: null, hidden: false, addEventListener() {}, removeEventListener() {} };
  doc.activeElement = doc.body;
  const loc = { pathname: path, search, hash: '', origin: 'https://sq.example', reload() {}, get href() { return loc.origin + loc.pathname + loc.search; }, set href(v) { loc.went = String(v); } };
  const hist = { scrollRestoration: 'auto', state: null, pushState() {}, replaceState(s, t, url) { const u = new URL(String(url), loc.origin); loc.pathname = u.pathname; loc.search = u.search; } };
  const win = { addEventListener() {}, removeEventListener() {}, scrollTo(x, y) { scrolls.push(['to', x, y]); }, scrollBy(x, y) { scrolls.push(['by', x, y]); }, postMessage() {} }; win.parent = win;
  const realNow = Date.now;
  const globals = {
    document: doc, window: win, location: loc, history: hist,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); } },
    navigator: { userAgent: 'test', sendBeacon: () => true, clipboard: { async writeText() {} }, share: null },
    fetch: async () => ({ ok: false, status: 404, json: async () => ({ ok: false }) }),
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, scrollTo(x, y) { scrolls.push(['to', x, y]); }, scrollY: 0, matchMedia: () => ({ matches: false }),
    setInterval: (f) => { ticks.push(f); return 0; }, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  };
  const before = Object.fromEntries(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  Date.now = () => realNow() + P.skew;
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const walk = (n, out = []) => { if (n.nodeType === 1) { out.push(n); for (const k of n.kids) walk(k, out); } return out; };
  Object.assign(P, {
    app, doc,
    done() { Date.now = realNow; for (const [k, d] of Object.entries(before)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } },
    async load(file) { const m = await import('../' + file + '?fix=' + (++LOADS)); await settle(); return m; },
    all: (tag) => walk(app).filter((n) => n.tag === tag),
    heads: (tag = 'h2') => walk(app).filter((n) => n.tag === tag).map((n) => n.textContent),
    tick() { for (const f of ticks) f(); },
    cer: () => walk(app).find((n) => n.className === 'cer')?.kids[0] || null,
    stage: () => walk(app).find((n) => /^stage/.test(n.className)) || null,
  });
  return P;
}
const GUEST = () => JSON.stringify({ token: 'g1.test.token', exp: 4102444800 });
const WIN = { a: KST('2026-11-25T18:00:00'), b: KST('2026-11-26T00:00:00') };
const view = (o = {}) => ({ id: 'abcd1234', to: '민지', from: '지수', occ: 'bday', msg: '생일 축하해!', th: 'party', day: '2026-11-25', ...WIN, scr: 'STREET_31', phase: 'live', lk: 1, n: 0, v: 0, vid: null, paper: [], open: true, takes: true, ...o });
const pageOf = (g, at) => fakeDom({ path: '/g/' + g.id, data: { id: g.id, gift: g, now: at, media: false }, at, store: { masil_gt: GUEST() } });

describe('the recipient page turns by itself without losing a half-written 롤링페이퍼 message', () => {
  // Types into both fields, puts the cursor in the message, and crosses `to` with the page's one-second tick.
  async function typing(g, at, cross) {
    const P = pageOf(g, at);
    await P.load('giftpage.js');
    const [nick] = P.all('input'), [txt] = P.all('textarea');
    nick.value = '수진'; txt.value = '민지야 생일 축'; txt.selectionStart = txt.selectionEnd = 8; txt.focus();
    const loadScrolls = P.scrolls.length;
    P.skew += cross; P.tick();
    return { P, nick, txt, loadScrolls };
  }
  it('at the lighting: the board view comes, the same fields keep the words, the caret and the focus; no jump to the top', async () => {
    const { P, nick, txt, loadScrolls } = await typing(view(), KST('2026-11-25T17:59:59.500'), 1000);
    try {
      assert.ok(P.stage(), 'the film: the page turned into the board'); assert.ok(P.heads().includes('광장에 걸린 글'));
      assert.equal(txt.isConnected, true, 'the message field was never taken out of the page');
      assert.equal(nick.isConnected, true);
      assert.equal(nick.value, '수진'); assert.equal(txt.value, '민지야 생일 축'); assert.equal(txt.selectionStart, 8);
      assert.equal(P.doc.activeElement, txt, 'the cursor is still in the message');
      assert.deepEqual(P.scrolls.slice(loadScrolls).filter((s) => s[0] === 'to'), [], 'no scrollTo(0, 0)');
      const order = P.heads(); assert.ok(order.indexOf('광장에 걸린 글') < order.indexOf('롤링페이퍼'), 'the 📺 card above the 롤링페이퍼, as on a page opened after the start');
    } finally { P.done(); }
  });
  it('at 00:00 of the day: the hidden preview says the time, the fields and the focus stay', async () => {
    const { P, nick, txt, loadScrolls } = await typing(view(), KST('2026-11-24T23:59:59.500'), 1000);
    try {
      assert.equal(P.stage(), null, 'still the before look');
      assert.ok(P.all('div').some((n) => n.className === 'label' && n.textContent === '켜지기까지'), 'the day\'s words');
      assert.equal(txt.isConnected && nick.isConnected, true); assert.equal(txt.value, '민지야 생일 축'); assert.equal(P.doc.activeElement, txt);
      assert.deepEqual(P.scrolls.slice(loadScrolls).filter((s) => s[0] === 'to'), []);
    } finally { P.done(); }
  });
  it('while the person is in the 롤링페이퍼 the card keeps its place on the screen (the column above it grew)', async () => {
    const P = pageOf(view(), KST('2026-11-25T17:59:59.500'));
    try {
      await P.load('giftpage.js');
      const [txt] = P.all('textarea');
      let sec = txt; while (sec && sec.tag !== 'section') sec = sec.parent;
      sec.getBoundingClientRect = () => ({ top: P.heads().includes('광장에 걸린 글') ? 700 : 300 }); // the film and the 📺 card push it down
      txt.value = '축하해'; txt.focus();
      const n = P.scrolls.length; P.skew += 1000; P.tick();
      assert.deepEqual(P.scrolls.slice(n), [['by', 0, 400]]);
    } finally { P.done(); }
  });
});

describe('the public view says whether a board was scheduled (giftView fx); a "지금" board made just after a start hour is no ceremony', () => {
  const made = (at) => ({ ...view(), at, st: 'live' }); // the stored row: its making time
  it('fx from the stored making time; a row without one has no fx and keeps the old rule', () => {
    assert.equal(giftView(made(KST('2026-11-20T10:00:00')), WIN.a).fx, 1);
    assert.equal(giftView(made(KST('2026-11-25T18:01:00')), WIN.a + 90000).fx, 0);
    assert.equal('fx' in giftView({ ...view(), st: 'live' }, WIN.a), false);
    assert.equal(cerStart({ ...view(), fx: 0 }), 0); assert.equal(cerStart({ ...view(), fx: 1 }), WIN.a); assert.equal(cerStart(view()), WIN.a, 'an older cached view');
  });
  it('the page: no 🎆 button for a "지금" board at 18:01; a scheduled board has 방금 켜졌어요', async () => {
    let P = pageOf(view({ fx: 0 }), KST('2026-11-25T18:01:00'));
    try { await P.load('giftpage.js'); assert.equal(P.cer(), null); } finally { P.done(); }
    P = pageOf(view({ fx: 1 }), KST('2026-11-25T18:01:00'));
    try { await P.load('giftpage.js'); assert.equal(P.cer()?.textContent, '방금 켜졌어요 · 점등식 보러 가기'); } finally { P.done(); }
  });
});

// ---- net.js: budget hard and a connection that only fails are two things -------------------------------------------------------------
describe('net.js budgetHard: only a real budget signal', () => {
  const g = globalThis, saved = {};
  const put = (k, v) => { saved[k] = Object.getOwnPropertyDescriptor(g, k); Object.defineProperty(g, k, { value: v, configurable: true, writable: true }); };
  const restore = () => { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(g, k, d); else delete g[k]; } };
  async function netMod() {
    const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
    put('window', g); put('navigator', { webdriver: false, onLine: true, userAgent: 'node' });
    put('document', { hidden: false, addEventListener() {}, removeEventListener() {} }); put('addEventListener', () => {});
    put('localStorage', store()); put('sessionStorage', store());
    put('location', { search: '', hostname: 'studio.wishboard.workers.dev', href: 'https://studio.wishboard.workers.dev/', protocol: 'https:', origin: 'https://studio.wishboard.workers.dev' });
    return import('../net.js?budget');
  }
  // What main.js gives the ceremony (mountGift budgetDown / netDown).
  const wired = (net) => ({ budget: !!net.budgetHard, down: !!net.gateDown });
  it('each way the connection fails sets gateDown only; the room\'s down and a full gate set budgetHard', async () => {
    const realST = g.setTimeout, realNow = Date.now, made = [];
    try {
      const { Net, rtPatch } = await netMod();
      const fresh = () => { const n = new Net(); n.emit = () => {}; made.push(n); return n; };
      // /rt/gate's own 503 ({ full: true, err: 1 }, worker.js): not the budget.
      let n = fresh(); n.gateBeat = async () => ({ full: true, err: 1 }); await n.gateEnter();
      assert.deepEqual(wired(n), { budget: false, down: true }, 'the gate\'s 503'); n.hardClear();
      // /rt/gate full: the budget.
      n = fresh(); n.gateBeat = async () => ({ full: true, used: 9 }); await n.gateEnter();
      assert.deepEqual(wired(n), { budget: true, down: true }, 'the gate full'); n.hardClear(); assert.equal(!!n.budgetHard, false, 'cleared in a room again');
      // Gate polls failing for 60 s.
      let t = 1.8e12; Date.now = () => t;
      n = fresh(); n.gateBeat = async () => { throw new Error('offline'); };
      g.setTimeout = (f, ms) => { t += Number(ms) || 0; if (n.gateDown) n.solo = true; Promise.resolve().then(f); return 0; };
      await n.gateEnter();
      assert.deepEqual(wired(n), { budget: false, down: true }, '60 s of failed gate polls');
      // The room socket failing for 60 s, and the room's 'down'.
      g.setTimeout = () => 0;
      n = fresh(); const sb = {}; rtPatch(sb, n); n.topic = 'chapel:square';
      const ch = sb.channel('chapel:square'); ch.cb = () => {};
      for (let i = 0; i < 8; i++) { t += 15000; ch.closed(null, true); }
      assert.deepEqual(wired(n), { budget: false, down: true }, 'a socket that keeps failing (rt.down without budget)');
      const ch2 = sb.channel('chapel:square'); ch2.cb = () => {};
      ch2.msg(JSON.stringify({ t: 'down' }));
      assert.deepEqual(wired(n), { budget: true, down: true }, 'the room said down (budget hard)');
      n.hardClear();
    } finally { for (const n of made) { n.solo = true; clearTimeout(n._hardT); } g.setTimeout = realST; Date.now = realNow; restore(); } // no reset timer left behind
  });
});

// ---- ts3d/screens.js: a ceremony pin never covers a screen someone lit (the harness of test/welcome.test.mjs) ---------------------------
function boardDom() {
  const ctx = () => {
    const words = [];
    return new Proxy({ words }, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
        if (k === 'clearRect') return () => { words.length = 0; };
        if (k === 'fillText') return (s) => { words.push(String(s)); };
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => {};
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  };
  globalThis.document = { createElement: () => { let c = null; return { width: 0, height: 0, getContext() { return c || (c = ctx()); } }; } };
}
const ROW = ['MAIN_TOP', 'SUB_1A', ...Array.from({ length: 12 }, (_, i) => 'STREET_' + (i + 1)), 'PLOT_1', 'PLOT_2'];
async function boardsOn(specs = ROW.map((id, i) => [id, { x: i * 10 }])) {
  boardDom();
  const { createBoards } = await import('../ts3d/screens.js');
  const THREE = await import('three');
  const boards = createBoards({ renderer: { capabilities: { getMaxAnisotropy: () => 4 } }, kitMats: {}, pick: [], quality: 'high' });
  const parent = new THREE.Group();
  for (const [id, s] of specs) boards.mount(id, parent, { x: 0, y: 5, z: 0, w: 16, h: 9, ...s });
  const words = (id) => boards.get(id).canvas.getContext('2d').words;
  return { boards, words, THREE, tick(n = 8) { for (let i = 0; i < n; i++) boards.update(0.1, new THREE.Vector3(40, 5, 20)); } };
}
const LIT = () => ({ holder_id: 'guest:a', holder_name: '주인', line1: '내 가게', line2: '', line3: '', lit_until: new Date(Date.now() + 36e5).toISOString() });
const cerGift = (start) => ({ id: 'fffffff1', to: '민지', from: '지수', occ: 'bday', msg: '비밀 문구 🤫', th: '', scr: 'STREET_5', a: start, b: start + 6 * 36e5, n: 2 });
const listGift = (id, scr) => ({ id, to: '하나', from: '', occ: 'bday', msg: '축하해', th: '', scr, a: Date.now() - 1000, b: Date.now() + 36e5, n: 0 });

describe('the ceremony pin moves off a screen a holder lights (giftPlace)', () => {
  it('to the nearest free screen; the lit screen shows its holder\'s board; the teaser goes on next door', async () => {
    const p = await boardsOn();
    const start = Date.now() + 5 * 60000;
    assert.equal(p.boards.pinGift(cerGift(start), 180000, { cer: start }), 'STREET_5');
    p.boards.set('STREET_5', LIT()); p.tick();
    const to = p.boards.giftSlot('fffffff1');
    assert.ok(to === 'STREET_4' || to === 'STREET_6', 'next door: ' + to);
    assert.equal(p.boards.get('STREET_5').gifts, null, 'nothing over the lit board');
    assert.equal(p.words('STREET_5').includes('곧 켜져요'), false);
    assert.ok(p.words('STREET_5').includes('내 가게'), 'the holder\'s board: ' + p.words('STREET_5').slice(-6).join(' | '));
    assert.ok(p.words(to).includes('곧 켜져요'), 'the teaser on the new screen');
    // At the start the card comes on the new screen; the photo's crossing (cerLit) is for that screen.
    assert.equal(p.boards.cerLit('STREET_5'), false); assert.equal(p.boards.cerLit(to), true);
  });
  it('a screen with another gift on it comes after an empty one', async () => {
    const p = await boardsOn();
    p.boards.setGifts([listGift('aaaaaaa1', 'STREET_6')]);
    const start = Date.now() + 5 * 60000;
    p.boards.pinGift(cerGift(start), 180000, { cer: start });
    p.boards.set('STREET_5', LIT()); p.tick();
    assert.equal(p.boards.giftSlot('fffffff1'), 'STREET_4');
    assert.equal(p.boards.giftSlot('aaaaaaa1'), 'STREET_6');
  });
  it('no free screen within reach: the pin goes (gift.js then ends the ceremony with a notice)', async () => {
    const p = await boardsOn([['STREET_5', { x: 0 }], ['STREET_6', { x: 300 }]]);
    const start = Date.now() + 5 * 60000;
    p.boards.pinGift(cerGift(start), 180000, { cer: start });
    p.boards.set('STREET_5', LIT()); p.tick();
    assert.equal(p.boards.giftSlot('fffffff1'), '');
    assert.ok(p.words('STREET_5').includes('내 가게'));
  });
});
