// 선물 전광판: the pure rules (giftrules.js) — the form, windows, scheduling, the plaza placement, phases and the 롤링페이퍼 lock,
// attribution, the price ladder, quiet hours, the video's type and ranges, the reply board's draft and the plaza replay rule — and
// what the light pages (giftpage.js) and the plaza glue (gift.js) show and send for the reply board, the replay and the video-first
// owner page, run in a small fake document (no browser).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GIFT, GIFT_SCREENS, OCCASIONS, TIERS, TIER_NOTE, TIER_ASK, won, giftFault, paperFault, windowFor, windowText, startChoices, dayText, hourText,
  screenLoad, pickScreen, nextFree, placeGifts, turnOf, giftPhase, keepUntil, pruneDay, paperOpen, paperTakes, lockArm, refOf, keptRef, REF_MS,
  giftView, giftShareText, countdown, videoKind, rangeOf, pickRecordType, quietNow, kstDay, dayStart, addDays, giftScreen,
  OCC_KEYS, REPLY_MSG, replyDraft, replyLabel, plazaLook, plazaNote, PLAZA_BTN, videoFirst, cpLen,
} from '../giftrules.js';

const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const KST = (s) => Date.parse(s + '+09:00');
const NOW = KST('2026-11-23T12:00:00'); // Monday noon KST
const form = (o = {}) => ({ to: '민지', from: '동아리', occ: 'bday', msg: '생일 축하해!', day: '2026-11-23', at: 'now', ...o });

// ---- the light pages and the plaza glue in a small fake document -----------------------------------------------------------------
// No browser here: just enough of a DOM for giftpage.js and gift.js to build what they show, so a test can press a button and read
// the page and what was sent. Canvas drawing goes nowhere. Timers, intervals and animation frames are kept and never run by
// themselves (P.timers() runs the timeouts, P.tick() the one-second lines). Each load is a fresh module instance.
// touch: a phone (the pointer is not a mouse: matchMedia('(pointer: fine)') is false). embed: the page is in the plaza's frame (?in=1 is
// the caller's to put in search); what it tells the plaza is kept in P.posted.
let LOADS = 0;
function fakeDom({ path = '/gift', search = '', data = null, store = {}, at = 0, respond = () => ({}), rec = false, touch = false, embed = false } = {}) {
  const sent = [], timeouts = [], ticks = [], winOn = {}, docOn = {}, swOn = {}, copied = [], shared = [], posted = [], P = { sent, store, copied, shared, posted, winOn, docOn, swOn, skew: at ? at - Date.now() : 0 };
  const ink = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => ink), set: (t, k, v) => { t[k] = v; return true; } });
  const text = (v) => ({ nodeType: 3, textContent: String(v), parent: null });
  const REFLECT = new Set(['hidden', 'disabled', 'href', 'id', 'type', 'src', 'title', 'placeholder']);
  const el = (tag) => {
    const n = { tag: String(tag).toLowerCase(), nodeType: 1, kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', parent: null, hidden: false, disabled: false, width: 0, height: 0 };
    const adopt = (c) => { const k = c && c.nodeType ? c : text(c); if (k.parent) k.parent.kids = k.parent.kids.filter((x) => x !== k); k.parent = n; return k; };
    Object.assign(n, {
      append(...cs) { for (const c of cs) n.kids.push(adopt(c)); }, prepend(...cs) { n.kids.unshift(...cs.map(adopt)); },
      after(c) { const i = n.parent.kids.indexOf(n); const k = c; if (k.parent) k.parent.kids = k.parent.kids.filter((x) => x !== k); k.parent = n.parent; n.parent.kids.splice(i + 1, 0, k); },
      replaceChildren(...cs) { for (const k of n.kids) k.parent = null; n.kids = []; n.append(...cs); },
      remove() { if (n.parent) n.parent.kids = n.parent.kids.filter((x) => x !== n); n.parent = null; },
      contains(o) { for (let x = o; x; x = x.parent) if (x === n) return true; return false; },
      setAttribute(k, v) { n.attrs[k] = String(v); if (REFLECT.has(k)) n[k] = k === 'hidden' || k === 'disabled' ? true : String(v); if (k === 'width' || k === 'height') n[k] = Number(v); },
      getAttribute: (k) => n.attrs[k] ?? null, addEventListener(t, f) { (n.on[t] ||= []).push(f); }, removeEventListener() {},
      focus(o) { doc.activeElement = n; n.focused = o || {}; }, matches: () => false, getContext: () => ink, canPlayType: () => '', play: () => Promise.resolve(), pause() {}, showPicker() {},
    });
    Object.defineProperty(n, 'textContent', { get: () => n.kids.map((k) => k.textContent).join(''), set(v) { n.replaceChildren(); if (v != null && v !== '') n.append(String(v)); } });
    Object.defineProperty(n, 'isConnected', { get: () => { for (let x = n; x; x = x.parent) if (x === app || x === doc.body) return true; return false; } });
    return n;
  };
  const app = el('main'), dataTag = data ? { textContent: JSON.stringify(data) } : null, toolWish = el('button');
  const doc = { getElementById: (id) => (id === 'app' ? app : id === 'gift-data' ? dataTag : id === 'view' ? el('canvas') : null), createElement: el, createTextNode: text, querySelector: () => toolWish,
    documentElement: { classList: { add() {} } }, head: el('head'), body: el('body'), activeElement: null, hidden: false, addEventListener(t, f) { (docOn[t] ||= []).push(f); }, removeEventListener() {} };
  doc.createElementNS = (ns, tag) => el(tag); // the line icon of the frame's close button (gift.js)
  el('div').append(toolWish); // the HUD's 🌠 button has a parent (gift.js puts 🎁 after it)
  P.tools = toolWish.parent;
  const loc = { pathname: path, search, hash: '', origin: 'https://sq.example', reloads: 0, reload() { loc.reloads++; }, get href() { return loc.origin + loc.pathname + loc.search; }, set href(v) { loc.went = String(v); } };
  // The session history of this document: entries with their state, as pushState and replaceState leave them.
  const entries = [{ url: path + search, state: null }]; let cur = 0;
  const hist = { scrollRestoration: 'auto', get state() { return entries[cur].state; },
    pushState(s, t, url) { entries.splice(cur + 1); entries.push({ url: String(url), state: s }); cur++; go(url); }, replaceState(s, t, url) { entries[cur] = { url: String(url), state: s }; go(url); } };
  const go = (url) => { const u = new URL(String(url), loc.origin); loc.pathname = u.pathname; loc.search = u.search; };
  const win = { addEventListener(t, f) { (winOn[t] ||= []).push(f); }, removeEventListener() {}, scrollTo() {}, postMessage() {} }; win.parent = embed ? { postMessage(m) { posted.push(m); } } : win;
  const realNow = Date.now;
  const globals = {
    document: doc, window: win, location: loc, history: hist,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); } },
    navigator: { userAgent: 'test', sendBeacon: () => true, clipboard: { async writeText(t) { copied.push(String(t)); } }, share: null, serviceWorker: { addEventListener(t, f) { swOn[t] = f; } } },
    fetch: async (url, opt = {}) => { sent.push({ url: String(url), method: opt.method || 'GET', body: typeof opt.body === 'string' ? JSON.parse(opt.body) : opt.body, auth: opt.headers?.authorization || '' }); const r = respond(String(url), opt); return { ok: !!r, status: r ? 200 : 404, json: async () => r || { ok: false }, blob: async () => new Blob([]) }; },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, scrollTo() {}, scrollY: 0, matchMedia: (q) => ({ matches: /pointer:\s*fine/.test(q) ? !touch : /pointer:\s*coarse/.test(q) ? touch : false }),
    setInterval: (f) => { ticks.push(f); return 0; }, clearInterval() {}, setTimeout: (f, ms) => { timeouts.push({ f, ms }); return 0; }, clearTimeout() {},
    // rec: a browser that can record a canvas (giftfilm.js canRecord); without it the two names are undefined, as in an in-app browser.
    MediaRecorder: rec ? function MediaRecorder() {} : undefined, HTMLCanvasElement: rec ? { prototype: { captureStream() {} } } : undefined,
  };
  const before = Object.fromEntries(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  Date.now = () => realNow() + P.skew;
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const walk = (n, out = []) => { if (n.nodeType === 1) { out.push(n); for (const k of n.kids) walk(k, out); } return out; };
  const shown = (n) => { for (let x = n; x; x = x.parent) if (x.hidden) return false; return true; };
  Object.assign(P, {
    app, doc, loc, settle, shown,
    /** The browser's back (-1) or forward (1) within this document: that entry's address and state, then popstate. */
    async step(d) { cur = Math.max(0, Math.min(entries.length - 1, cur + d)); go(entries[cur].url); for (const f of winOn.popstate || []) f(); await settle(); },
    done() { Date.now = realNow; for (const [k, d] of Object.entries(before)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } },
    async load(file) { const m = await import('../' + file + '?load=' + (++LOADS)); await settle(); return m; },
    all: (tag, root = app) => walk(root).filter((n) => n.tag === tag),
    /** The button or link on screen whose words match (hidden ones are not on screen). */
    btn: (re, root = app) => walk(root).find((n) => (n.tag === 'button' || n.tag === 'a') && shown(n) && re.test(n.textContent)) || null,
    heads: (tag = 'h2') => walk(app).filter((n) => n.tag === tag && shown(n)).map((n) => n.textContent),
    says: (re) => walk(app).some((n) => shown(n) && n.kids.some((k) => k.nodeType === 3 && re.test(k.textContent))),
    async press(n, ev = {}) { assert.ok(n, 'the button is on screen'); for (const f of n.on.click || []) await f({ preventDefault() {}, target: n, ...ev }); await settle(); },
    async submit() { const f = walk(app).find((n) => n.tag === 'form'); assert.ok(f, 'a form'); for (const s of f.on.submit) await s({ preventDefault() {} }); await settle(); },
    input: (id) => walk(app).find((n) => n.attrs.id === id) || null,
    async timers() { for (const t of timeouts.splice(0)) await t.f(); await settle(); }, timeouts,
    tick() { for (const f of ticks) f(); },
    /** A key pressed with the cursor in this document (on: P.winOn or P.docOn). Says whether a listener took it for itself. */
    async key(on, key, more = {}) { const e = { key, isComposing: false, keyCode: 0, defaultPrevented: false, stopped: false, preventDefault() { e.defaultPrevented = true; }, stopPropagation() { e.stopped = true; }, ...more }; for (const f of on.keydown || []) f(e); await settle(); return e; },
    /** Every button and link on screen. */
    controls: (root = app) => walk(root).filter((n) => (n.tag === 'button' || n.tag === 'a') && shown(n)),
    seen: (id, e) => { try { return !!JSON.parse(store.kts_gseen || '{}')[id + ':' + e]; } catch { return false; } },
  });
  return P;
}
const GUEST = () => JSON.stringify({ token: 'g1.test.token', exp: 4102444800 }); // a guest this browser already has: nothing is minted
const DAY = '2026-11-25', WIN = { a: KST('2026-11-25T18:00:00'), b: KST('2026-11-26T00:00:00') };
// A board's public view as the Worker sends it (to 민지, from 지수, the 25th 18:00 to midnight).
const view = (o = {}) => ({ id: 'abcd1234', to: '민지', from: '지수', occ: 'bday', msg: '생일 축하해!', th: 'party', day: DAY, ...WIN, scr: 'STREET_31', phase: 'live', lk: 1, n: 0, v: 0, vid: null, paper: [], open: true, takes: true, ...o });
const pageOf = (g, at, o = {}) => fakeDom({ path: '/g/' + g.id, data: { id: g.id, gift: g, now: at, media: false }, at, store: { masil_gt: GUEST() }, ...o });

describe('the form', () => {
  it('takes a name, an occasion, a short line and a window; the theme follows the occasion unless chosen', () => {
    const r = giftFault(form(), NOW);
    assert.equal(r.ok, true);
    assert.equal(r.v.th, OCCASIONS.bday.th);
    assert.equal(r.v.a, Math.floor(NOW / 600000) * 600000);
    assert.equal(r.v.b - r.v.a, GIFT.hours * 36e5);
    assert.equal(giftFault(form({ th: 'night' }), NOW).v.th, 'night');
    assert.equal(giftFault(form({ th: 'nope' }), NOW).v.th, OCCASIONS.bday.th);
    assert.equal(giftFault(form({ msg: '', from: '' }), NOW).ok, true, 'the line and the sender are optional');
    assert.equal(giftFault(form({ to: '  민​지  ' }), NOW).v.to, '민지', 'zero-width marks and spaces go');
  });
  it('refuses what a board must not carry, field by field', () => {
    const f = (o) => { const r = giftFault(form(o), NOW); return r.ok ? '' : r.field + ':' + r.code; };
    assert.equal(f({ to: '' }), 'to:to');
    assert.equal(f({ to: '운영자' }), 'to:name');
    assert.equal(f({ to: 'x'.repeat(GIFT.toMax + 1) }), 'to:long');
    assert.equal(f({ from: '01012345678' }), 'from:name');
    assert.equal(f({ msg: '연락 010-1234-5678' }), 'msg:link');
    assert.equal(f({ msg: 'https://evil.example/x' }), 'msg:link');
    assert.equal(f({ msg: 'x'.repeat(GIFT.msgMax + 1) }), 'msg:long');
    assert.equal(f({ occ: 'party' }), 'occ:occ');
    assert.equal(f({ day: '2026-11-22' }), 'day:day');
    assert.equal(f({ day: addDays('2026-11-23', GIFT.aheadDays + 1), at: 18 }), 'day:day');
    assert.equal(f({ day: '2026-02-30', at: 18 }), 'day:day');
    assert.equal(f({ day: '2026-11-24', at: 'now' }), 'at:at', '"now" is for today only');
    assert.equal(f({ at: 9 }), 'at:past');
    assert.equal(f({ at: 13 }), 'at:at', 'only the offered start hours');
    assert.equal(giftFault(null).ok, false);
  });
  it('offers today now and the hours still ahead, a later day every start hour, nothing outside the range', () => {
    assert.deepEqual(startChoices('2026-11-23', NOW), ['now', 15, 18]);
    assert.deepEqual(startChoices('2026-11-24', NOW), [9, 12, 15, 18]);
    assert.deepEqual(startChoices('2026-11-22', NOW), []);
    assert.deepEqual(startChoices(addDays('2026-11-23', 31), NOW), []);
    assert.deepEqual(startChoices('2026-11-23', KST('2026-11-23T19:00:00')), ['now']);
  });
  it('says the window in Korean', () => {
    const w = windowFor('2026-12-25', 18, NOW);
    assert.equal(windowText(w.a, w.b), '12월 25일 (금) 저녁 6시 ~ 자정');
    const late = windowFor('2026-11-23', 'now', KST('2026-11-23T22:05:00'));
    assert.equal(windowText(late.a, late.b), '11월 23일 (월) 밤 10시 ~ 다음 날 새벽 4시');
    assert.equal(hourText(12), '낮 12시'); assert.equal(hourText(9), '오전 9시'); assert.equal(hourText(15), '오후 3시'); assert.equal(dayText('2026-11-23'), '11월 23일 (월)');
    assert.equal(countdown(3 * 864e5 + 5), 'D-3'); assert.equal(countdown(3 * 36e5 + 12 * 6e4), '3시간 12분'); assert.equal(countdown(65000), '1분 5초');
  });
  it('a 롤링페이퍼 line: a short text, an optional nick (default 친구), the same filters', () => {
    assert.deepEqual(paperFault({ nick: '', txt: ' 생일 축하해 ' }).v, { nick: '친구', txt: '생일 축하해' });
    assert.equal(paperFault({ txt: '' }).code, 'paperEmpty');
    assert.equal(paperFault({ txt: '전화 01012345678' }).code, 'link');
    assert.equal(paperFault({ nick: '관리자', txt: '안녕' }).code, 'name');
    assert.equal(paperFault({ txt: 'x'.repeat(GIFT.paper.txtMax + 1) }).code, 'long');
  });
});

describe('scheduling', () => {
  it('uses ordinary screens only: streets and lots, never the main tower, the corner towers or the ad screens', () => {
    assert.equal(GIFT_SCREENS.length, 68);
    assert.ok(GIFT_SCREENS.every((s) => /^(STREET_\d+|PLOT_\d+)$/.test(s)));
    for (const s of ['MAIN_TOP', 'MAIN_UP', 'SUB_1A', 'SUB_4B', 'AD_1', 'AD_5']) assert.equal(giftScreen(s), false, s);
    assert.equal(GIFT_SCREENS[0], 'STREET_31', 'the bowtie\'s own screens first');
  });
  it('spreads boards one per screen first, then shares a screen up to GIFT.perScreen, then is full', () => {
    const rows = [], a = NOW, b = NOW + 6 * 36e5;
    for (let i = 0; i < GIFT_SCREENS.length; i++) rows.push({ scr: pickScreen(rows, a, b), a, b });
    assert.deepEqual(rows.map((r) => r.scr), GIFT_SCREENS, 'each screen once');
    const pool = ['STREET_1', 'STREET_2'], few = [];
    for (let i = 0; i < 2 * GIFT.perScreen; i++) { const s = pickScreen(few, a, b, pool); assert.ok(s, 'room ' + i); few.push({ scr: s, a, b }); }
    assert.equal(pickScreen(few, a, b, pool), '', 'full');
    assert.equal(screenLoad(few, 'STREET_1', a, b), GIFT.perScreen);
    assert.equal(pickScreen(few, b, b + 36e5, pool), 'STREET_1', 'the next window is free again');
    assert.equal(screenLoad([{ scr: 'STREET_1', a, b: a + 36e5 }, { scr: 'STREET_1', a: a + 36e5, b }], 'STREET_1', a, b), 1, 'back to back is not overlap');
  });
  it('suggests the next window that still has a screen', () => {
    const pool = GIFT_SCREENS, rows = [];
    const w = windowFor('2026-11-23', 'now', NOW);
    for (const s of pool) for (let i = 0; i < GIFT.perScreen; i++) rows.push({ scr: s, a: w.a - 36e5, b: w.a + 6 * 36e5 }); // full until 18:00
    const n = nextFree(rows, '2026-11-23', NOW);
    assert.deepEqual(n, { day: '2026-11-23', at: 18 }, 'today at 18 is past the full stretch');
  });
});

describe('the plaza places what is live', () => {
  const gifts = [{ id: 'aaaaaaa1', scr: 'STREET_31', a: 1 }, { id: 'aaaaaaa2', scr: 'STREET_31', a: 2 }, { id: 'aaaaaaa3', scr: 'STREET_32', a: 3 }];
  it('keeps a board on its screen while that screen is free', () => {
    const p = placeGifts(gifts, () => true);
    assert.deepEqual([...p], [['STREET_31', ['aaaaaaa1', 'aaaaaaa2']], ['STREET_32', ['aaaaaaa3']]]);
  });
  it('moves boards off a screen someone lit to the least-loaded free one, never covering it', () => {
    const p = placeGifts(gifts, (s) => s !== 'STREET_31');
    assert.equal(p.has('STREET_31'), false);
    assert.deepEqual(p.get('STREET_33'), ['aaaaaaa1']); assert.deepEqual(p.get('STREET_34'), ['aaaaaaa2']);
    assert.deepEqual(placeGifts(gifts, () => false), new Map(), 'no free screen: nothing shows');
    const per = placeGifts(Array.from({ length: 6 }, (_, i) => ({ id: 'bbbbbbb' + i, scr: 'STREET_1', a: i })), (s) => s === 'STREET_1' || s === 'STREET_2');
    assert.equal(per.get('STREET_1').length, GIFT.perScreen); assert.equal(per.get('STREET_2').length, 2);
  });
  it('turns shared screens by the wall clock, the same for every viewer', () => {
    assert.equal(turnOf(3, 0), 0); assert.equal(turnOf(3, GIFT.cycleMs), 1); assert.equal(turnOf(3, 3 * GIFT.cycleMs), 0); assert.equal(turnOf(0, 5), 0);
  });
});

describe('phases, keeping and the 롤링페이퍼 lock (E3)', () => {
  const g = { id: 'cccccccc', st: 'live', day: '2026-11-25', a: KST('2026-11-25T18:00:00'), b: KST('2026-11-26T00:00:00'), lk: 1 };
  it('before the day, on the day, on the plaza, after, gone (the day plus 7 days)', () => {
    assert.equal(giftPhase(g, KST('2026-11-24T23:59:59')), 'before');
    assert.equal(giftPhase(g, KST('2026-11-25T00:00:00')), 'day');
    assert.equal(giftPhase(g, g.a), 'live');
    assert.equal(giftPhase(g, g.b), 'after');
    assert.equal(keepUntil(g), KST('2026-12-03T00:00:00'), 'the policy: 그날이 지나고 7일 뒤');
    assert.equal(giftPhase(g, KST('2026-12-02T23:59:59')), 'after');
    assert.equal(giftPhase(g, KST('2026-12-03T00:00:00')), 'gone');
    assert.equal(giftPhase({ ...g, st: 'hidden' }, g.a), 'gone');
    assert.equal(pruneDay(KST('2026-12-03T00:00:00')), '2026-11-25', 'that day is pruned from then on');
    assert.equal(pruneDay(KST('2026-12-02T23:59:59')), '2026-11-24');
  });
  it('locks lines until 00:00 of the day; the open arm shows them at once; lines are taken until the window ends', () => {
    assert.equal(paperOpen(g, KST('2026-11-24T23:00:00')), false);
    assert.equal(paperOpen(g, KST('2026-11-25T00:00:00')), true);
    assert.equal(paperOpen({ ...g, lk: 0 }, KST('2026-11-20T00:00:00')), true);
    assert.equal(paperTakes(g, g.b - 1), true); assert.equal(paperTakes(g, g.b), false);
    assert.equal(lockArm('abcdefgh', false), 1, 'no split: every board locks');
    const arms = new Set(); for (const id of ['aaaaaaaa', 'aaaaaaab', 'aaaaaaac', 'aaaaaaad', 'zzzzzzz1', 'zzzzzzz2']) arms.add(lockArm(id, true));
    assert.deepEqual([...arms].sort(), [0, 1], 'the split gives both arms');
  });
  it('the public view never carries the owner, the network or a writer; lines only once open', () => {
    const stored = { ...g, uid: 'guest:x', ip: 'abc', to: '민지', from: 'A', occ: 'bday', msg: 'hi', th: 'party', scr: 'STREET_31', n: 2, paper: [{ id: 'p00001', nick: '친구', txt: '축하', uid: 'guest:y' }] };
    const before = giftView(stored, KST('2026-11-24T00:00:00')), after = giftView(stored, g.a);
    for (const v of [before, after]) { const s = JSON.stringify(v); assert.equal(s.includes('guest:'), false); assert.equal('ip' in v, false); assert.equal('uid' in v, false); }
    assert.equal(before.paper, null); assert.equal(before.n, 2);
    assert.deepEqual(after.paper, [{ id: 'p00001', nick: '친구', txt: '축하' }]);
    assert.match(giftShareText(stored).title, /민지님을 위한 선물 전광판/);
  });
});

describe('the reply board (답장 전광판) and the plaza replay', () => {
  it('고마움 is an occasion of its own: the same table for the server, the pages and the art', () => {
    assert.deepEqual(OCC_KEYS, ['bday', 'anniv', 'pass', 'cheer', 'just', 'thanks', 'love', 'grad', 'me'], 'the five days people pick first, then 고마움; 사랑, 졸업·승진 and 내 전광판 (2026-11-27) after them');
    assert.equal(OCCASIONS.thanks.name, '고마움'); assert.equal(OCCASIONS.thanks.hint, REPLY_MSG);
    const r = giftFault({ to: '지수', occ: 'thanks', day: '2026-11-23', at: 'now' }, NOW);
    assert.equal(r.ok, true); assert.equal(r.v.occ, 'thanks'); assert.equal(r.v.th, 'rose');
    assert.match(giftShareText({ to: '지수', occ: 'thanks' }).text, /정말 고마워요!$/);
  });
  it('a reply is filled in from the board it answers: the names swapped, 고마움, the thanks line; every value passes the form', () => {
    assert.deepEqual(replyDraft({ to: '민지', from: '지수' }), { to: '지수', from: '민지', occ: 'thanks', msg: REPLY_MSG, th: '' });
    assert.equal(replyDraft({ to: '민지', from: '' }).to, '', 'no sender name: the recipient writes who it is for');
    assert.deepEqual(replyDraft(null), { to: '', from: '', occ: 'thanks', msg: REPLY_MSG, th: '' });
    assert.ok(cpLen(REPLY_MSG) <= GIFT.msgMax, 'the line fits a board');
    const filled = giftFault({ ...replyDraft({ to: '민지', from: '지수' }), day: '2026-11-23', at: 'now' }, NOW);
    assert.equal(filled.ok, true, JSON.stringify(filled));
    assert.deepEqual([filled.v.to, filled.v.from, filled.v.msg, filled.v.th], ['지수', '민지', REPLY_MSG, 'rose']);
    const long = replyDraft({ to: '가'.repeat(30), from: '  나' + String.fromCharCode(0x200b) + '나'.repeat(30) });
    assert.equal(cpLen(long.to), GIFT.toMax); assert.equal(cpLen(long.from), GIFT.fromMax, 'cut to the limits, marks and spaces out');
    assert.equal(giftFault({ ...replyDraft({ to: '민지', from: '운영자' }), day: '2026-11-23', at: 'now' }, NOW).code, 'name', 'a name the form refuses is still refused');
  });
  it('the reply button is named after the sender when the board has one', () => {
    assert.equal(replyLabel({ to: '민지', from: '지수' }), '💌 지수님에게 답장 전광판 걸기');
    assert.equal(replyLabel({ to: '민지', from: '' }), '💌 고마워 전광판 걸기');
    assert.equal(replyLabel(null), '💌 고마워 전광판 걸기');
  });
  it('the recipient page: after the film the reply is the first button; one tap opens the maker filled in, one more hangs it as a reply', async () => {
    const g = view(), made = view({ id: 'rrrrrrrr', to: '지수', from: '민지', occ: 'thanks', msg: REPLY_MSG, th: 'rose' });
    const P = pageOf(g, KST('2026-11-25T19:00:00'), { respond: (u, o) => (u === '/rt/gift' && o.method === 'POST' ? { ok: true, id: made.id, url: 'https://sq.example/g/' + made.id, gift: made, mine: { kids: 0, vd: 0, at: 1, lk: 1 }, media: false } : null) });
    try {
      await P.load('giftpage.js');
      assert.deepEqual(P.heads('h1'), ['🎂 민지님, 생일 축하해요!']);
      assert.equal(P.btn(/답장/), null, 'the film first');
      await P.press(P.btn(/영상 건너뛰기/));
      const reply = P.btn(/답장/);
      assert.equal(reply.textContent, '💌 지수님에게 답장 전광판 걸기');
      assert.equal(reply.parent.kids[0], reply, 'the first of the buttons');
      assert.deepEqual(reply.parent.kids.filter((n) => n.tag === 'button' || n.tag === 'a').map((n) => n.textContent), ['💌 지수님에게 답장 전광판 걸기', '⬇ 영상 저장', '🗽 직접 가서 보기', '🎁 나도 누군가에게 걸어 주기']);
      await P.press(reply);
      assert.equal(P.seen(g.id, 'reply'), true, 'counted once per device and day');
      assert.equal(JSON.parse(P.store.kts_gref).id, g.id, 'kept as the ref, like ?ref=');
      assert.equal(P.loc.pathname, '/gift');
      assert.deepEqual(P.heads('h1'), ['💌 답장 전광판을 걸어요']);
      // Back to the board and forward again: the reply's maker, filled in as before.
      await P.step(-1); assert.equal(P.loc.pathname, '/g/' + g.id); assert.deepEqual(P.heads('h1'), ['🎂 민지님, 생일 축하해요!']);
      await P.step(1); assert.equal(P.loc.pathname, '/gift'); assert.deepEqual(P.heads('h1'), ['💌 답장 전광판을 걸어요']);
      assert.deepEqual(['to', 'msg', 'from'].map((id) => P.input(id).value), ['지수', REPLY_MSG, '민지'], 'who it is for, the thanks line, who it is from');
      assert.equal(P.all('button').find((n) => n.attrs['aria-pressed'] === 'true' && /고마움/.test(n.textContent)).textContent, '🙏 고마움');
      assert.match(P.all('p').map((n) => n.textContent).join('\n'), /11월 25일 \(수\) 저녁 7시 ~ 다음 날 새벽 1시/, 'today, now');
      assert.equal(P.timeouts.length, 0, 'a filled reply does not pull the keyboard up');
      assert.equal(P.btn(/답장 걸기/).textContent, '💌 답장 걸기');
      await P.submit();
      const post = P.sent.find((s) => s.url === '/rt/gift' && s.method === 'POST');
      assert.deepEqual(post.body, { to: '지수', from: '민지', occ: 'thanks', msg: REPLY_MSG, th: 'rose', day: DAY, at: 'now', ref: g.id, re: 1 });
      assert.equal(post.auth, 'Bearer g1.test.token');
      assert.deepEqual(P.heads('h1'), ['🎉 걸었어요!'], 'the reply\'s own owner page');
      assert.equal(P.loc.pathname, '/g/' + made.id); assert.equal(P.store.kts_gref, '', 'the ref is used up'); assert.deepEqual(JSON.parse(P.store.kts_gmine), [made.id]);
      // Back twice (the maker, then the board that was answered): an ordinary maker now that the reply is hung, then that board
      // again under its own address, not the reply just made.
      await P.step(-1); assert.equal(P.loc.pathname, '/gift'); assert.deepEqual(P.heads('h1'), ['친구를 위해 뉴욕 타임스퀘어에 전광판을 걸어요']);
      await P.step(-1); assert.equal(P.loc.pathname, '/g/' + g.id); assert.deepEqual(P.heads('h1'), ['🎂 민지님, 생일 축하해요!']);
    } finally { P.done(); }
  });
  it('a board without a sender name: the reply is a thanks board and the cursor waits at who it is for; the form still checks what is typed', async () => {
    const g = view({ from: '' });
    const P = pageOf(g, KST('2026-11-26T09:00:00')); // the morning after: the page lives 7 more days
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/영상 건너뛰기/));
      assert.equal(P.btn(/전광판 걸기$/).textContent, '💌 고마워 전광판 걸기');
      await P.press(P.btn(/고마워 전광판 걸기/));
      assert.deepEqual(['to', 'msg', 'from'].map((id) => P.input(id).value), ['', REPLY_MSG, '민지']);
      await P.timers(); assert.equal(P.doc.activeElement, P.input('to'));
      await P.submit();
      assert.equal(P.sent.some((s) => s.method === 'POST'), false, 'nothing is sent without a name');
      assert.equal(P.says(/받는 사람 이름을 적어 주세요/), true);
      P.input('to').value = '운영자'; for (const f of P.input('to').on.input) f();
      await P.submit();
      assert.equal(P.sent.some((s) => s.method === 'POST'), false); assert.equal(P.says(/그 이름은 쓸 수 없어요/), true, 'the usual checks');
    } finally { P.done(); }
  });
  it('the maker by itself is as before: its own words, a kept ref without re, the cursor at the name', async () => {
    const P = fakeDom({ path: '/gift', search: '?ref=abcd1234', at: KST('2026-11-25T19:00:00'), store: { masil_gt: GUEST() }, respond: (u, o) => (u === '/rt/gift' && o.method === 'POST' ? { ok: true, id: 'nnnnnnnn', gift: view({ id: 'nnnnnnnn', to: '수아' }), mine: {}, media: false } : null) });
    try {
      await P.load('giftpage.js');
      assert.deepEqual(P.heads('h1'), ['친구를 위해 뉴욕 타임스퀘어에 전광판을 걸어요']); assert.equal(P.btn(/걸기$/).textContent, '🎁 무료로 걸기');
      assert.equal(P.all('button').filter((n) => n.className === 'chip' && /고마움/.test(n.textContent)).length, 1, '고마움 can be picked by anyone');
      assert.equal(P.timeouts.length, 1); await P.timers(); assert.equal(P.doc.activeElement, P.input('to'));
      P.input('to').value = '수아'; for (const f of P.input('to').on.input) f();
      await P.submit();
      assert.deepEqual(P.sent.find((s) => s.method === 'POST').body, { to: '수아', from: '', occ: 'bday', msg: '', th: 'party', day: DAY, at: 'now', ref: 'abcd1234' });
    } finally { P.done(); }
  });
  it('the owner page: a card on top once a reply came, with the way to it; not without one, and the owner\'s preview offers no reply', async () => {
    const g = view();
    const own = (mine) => pageOf(g, KST('2026-11-25T19:00:00'), { store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([g.id]) }, respond: (u) => (u === '/rt/gift/' + g.id ? { ok: true, gift: g, own: true, mine, media: false } : u.endsWith('/interest') ? { ok: true } : null) });
    let P = own({ kids: 1, vd: 0, at: 1, lk: 1, re: 'rrrrrrrr' });
    try {
      await P.load('giftpage.js');
      assert.equal(P.heads()[0], '💌 답장이 도착했어요');
      const see = P.btn(/답장 보기/);
      assert.equal(see.tag, 'a'); assert.equal(see.href, '/g/rrrrrrrr');
      assert.deepEqual(P.heads().slice(1, 4), ['🔗 링크 보내기', '✨ 더 크게, 더 오래 걸고 싶다면', '🎬 15초 축하 영상'], 'the rest as it was');
      await P.press(P.btn(/받는 사람에게 보이는 화면/));
      assert.equal(P.btn(/답장|고마워 전광판/), null, 'the preview is the owner looking: nothing to answer');
      assert.ok(P.btn(/영상 저장/), 'the preview shows the buttons at once');
    } finally { P.done(); }
    P = own({ kids: 0, vd: 0, at: 1, lk: 1 });
    try { await P.load('giftpage.js'); assert.equal(P.heads()[0], '🔗 링크 보내기'); assert.equal(P.btn(/답장 보기/), null); } finally { P.done(); }
    for (const f of ['giftpage.js', 'gift.js', 'admin-gift.js']) assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src(f)), false, f + ': what people wrote is only ever set as text');
  });
  it('?gb= in the plaza: live in its window, a replay on this device from the day until the page goes, a wait before the day, gone after', () => {
    const g = { id: 'cccccccc', day: '2026-11-25', a: KST('2026-11-25T18:00:00'), b: KST('2026-11-26T00:00:00') };
    assert.equal(plazaLook(g, KST('2026-11-24T12:00:00')), 'wait');
    assert.equal(plazaLook(g, KST('2026-11-24T23:59:59')), 'wait');
    // 점등식 (2026-11-24): an 18:00 board is a ceremony board; it is not previewed before its lighting. A board without a fixed start
    // still is, from its day (the G6 tests).
    assert.equal(plazaLook(g, KST('2026-11-25T00:00:00')), 'wait', 'the day has come, but not the lighting');
    assert.equal(plazaLook(g, KST('2026-11-25T10:00:00')), 'wait');
    assert.equal(plazaLook(g, g.a), 'live'); assert.equal(plazaLook(g, KST('2026-11-25T19:00:00')), 'live');
    assert.equal(plazaLook(g, g.b), 'replay', 'the window is over, the page lives');
    assert.equal(plazaLook(g, KST('2026-11-28T12:00:00')), 'replay');
    assert.equal(plazaLook(g, KST('2026-12-02T23:59:59')), 'replay', 'the last second of the 7 days');
    assert.equal(plazaLook(g, KST('2026-12-03T00:00:01')), 'gone');
    assert.equal(plazaLook(null), 'gone'); assert.equal(plazaLook({ a: 1, b: 2 }, 1), 'gone', 'no day: not a board\'s public view');
    assert.equal(plazaLook({ ...g, day: '2026-02-30' }, g.a), 'gone');
    const late = { day: '2026-11-23', a: KST('2026-11-23T22:00:00'), b: KST('2026-11-24T04:00:00') };
    assert.equal(plazaLook(late, KST('2026-11-24T03:00:00')), 'live', 'a late "지금" window runs past midnight');
  });
  it('the words: the page\'s plaza button by phase (none before the day) and the plaza\'s toast for a visit or a replay', () => {
    assert.deepEqual({ ...PLAZA_BTN }, { day: '🗽 광장에서 미리 보기', live: '🗽 직접 가서 보기', after: '🗽 광장에서 다시 보기' });
    const g = view();
    assert.equal(plazaNote(g, 'live', KST('2026-11-25T19:00:00')), '🎁 민지님을 위한 선물 전광판이에요!');
    assert.equal(plazaNote(g, 'replay', KST('2026-11-25T10:00:00')), '🎁 민지님을 위한 선물 전광판이에요 · 광장에는 저녁 6시에 걸려요');
    assert.equal(plazaNote(g, 'replay', KST('2026-11-28T12:00:00')), '🎁 민지님을 위한 선물 전광판이에요 · 이 기기에서만 다시 보여 드려요');
  });
  it('the recipient page\'s plaza button follows the clock: a preview on the day, the visit while it hangs, a replay after; none before the day', async () => {
    // A window that is not a start hour (no 점등식): the day view before the window offers the preview. An 18:00 board (a 점등식) shows
    // the before look until 18:00 (the G6 tests) and so never offers it.
    const g = view({ a: KST('2026-11-25T18:20:00'), b: KST('2026-11-26T00:20:00') });
    let P = pageOf(g, KST('2026-11-25T10:00:00'));
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/영상 건너뛰기/));
      const go = P.btn(/^🗽/);
      assert.equal(go.textContent, '🗽 광장에서 미리 보기'); assert.equal(go.href, '/?gb=' + g.id);
      P.skew += 9 * 36e5; P.tick(); assert.equal(go.textContent, '🗽 직접 가서 보기'); // 19:00
      P.skew += 6 * 36e5; P.tick(); assert.equal(go.textContent, '🗽 광장에서 다시 보기'); // 01:00, the window is over
      await P.press(go); assert.equal(P.seen(g.id, 'go'), true, 'counted as before');
    } finally { P.done(); }
    P = pageOf(view(), KST('2026-11-25T18:00:00'));
    try { await P.load('giftpage.js'); await P.press(P.btn(/영상 건너뛰기/)); assert.equal(P.btn(/^🗽/).textContent, '🗽 직접 가서 보기', 'an 18:00 board: the visit from its start'); } finally { P.done(); }
    P = pageOf(view({ phase: 'before' }), KST('2026-11-24T12:00:00'));
    try { await P.load('giftpage.js'); assert.deepEqual(P.heads('h1'), ['🎂 민지님을 위한 선물 전광판']); assert.equal(P.btn(/^🗽/), null); assert.equal(P.btn(/답장|고마워 전광판/), null, 'nothing to answer before the day'); } finally { P.done(); }
  });
  // The plaza side (gift.js) with a world that only records what it is asked to do.
  // extra: more of the world (towerSlot); mount: more for mountGift (towerAdd).
  async function plaza({ at, search = '?gb=abcd1234', gift = null, list = null, extra = {}, mount = {} } = {}) {
    const P = fakeDom({ path: '/', search, at, store: { masil_gt: GUEST() }, respond: (u) => (/^\/rt\/gift\/[0-9a-z]{8}$/.test(u) && gift ? { ok: true, gift, own: false } : null) });
    P.notes = []; P.calls = [];
    const world = { pinGift: (g, ms) => { P.calls.push(['pin', g.id, ms]); return 'STREET_40'; }, goToSlot: (s) => P.calls.push(['go', s]), focusSlot: (s) => P.calls.push(['focus', s]), cheerAt: (s) => P.calls.push(['cheer', s]), setGifts() {}, setInputEnabled() {}, ...extra };
    const { mountGift } = await P.load('gift.js');
    P.gift = mountGift({ world, ui: { note: (t, k, fn) => P.notes.push({ t, k, fn }) }, whenBuilt: (f) => f(), introDone() {}, ...mount });
    if (list) P.gift.apply(list);
    return P;
  }
  const SHOWN = [['pin', 'abcd1234', 60000], ['go', 'STREET_40'], ['focus', 'STREET_40'], ['cheer', 'STREET_40']];
  it('?gb= in the plaza shows the board on this device on its day and after its window, with the same camera and fireworks', async () => {
    const g = view();
    let P = await plaza({ at: KST('2026-11-28T12:00:00'), gift: view({ phase: 'after' }) });
    try {
      assert.equal(P.gift.arrive(), true); await P.settle(); await P.timers();
      assert.deepEqual(P.calls, SHOWN, 'pinned for a minute, the avatar and the camera on it, fireworks');
      assert.deepEqual(P.notes.map((n) => [n.t, n.k]), [['🎁 민지님을 위한 선물 전광판이에요 · 이 기기에서만 다시 보여 드려요', 'ok']]);
      assert.equal(P.loc.search, '', 'the link is used up');
    } finally { P.done(); }
    P = await plaza({ at: KST('2026-11-25T10:00:00'), gift: view({ phase: 'day', a: KST('2026-11-25T18:20:00'), b: KST('2026-11-26T00:20:00') }) }); // no fixed start
    try {
      P.gift.arrive(); await P.settle(); await P.timers();
      assert.deepEqual(P.calls, SHOWN); assert.equal(P.notes[0].t, '🎁 민지님을 위한 선물 전광판이에요 · 광장에는 저녁 6시 20분에 걸려요');
    } finally { P.done(); }
    // 점등식 (an 18:00 board) on its day before the start: no preview with the message, only when it hangs (as before the day).
    P = await plaza({ at: KST('2026-11-25T10:00:00'), gift: view({ phase: 'day' }) });
    try {
      P.gift.arrive(); await P.settle(); await P.timers();
      assert.deepEqual(P.calls, []); assert.deepEqual(P.notes.map((n) => [n.t, n.k]), [['이 선물 전광판은 11월 25일 (수) 저녁 6시 ~ 자정에 걸려요', 'ok']]);
    } finally { P.done(); }
    // Hanging now: the world's own copy (no day in it) is enough, nothing is fetched; the same from the frame's "직접 가서 보기".
    P = await plaza({ at: KST('2026-11-25T19:00:00'), search: '', list: [{ id: g.id, to: g.to, from: g.from, occ: g.occ, msg: g.msg, th: g.th, scr: g.scr, a: g.a, b: g.b, n: 0 }] });
    try {
      assert.equal(P.gift.arrive(), false, 'no link: the usual arrival');
      for (const f of P.winOn.message) f({ origin: P.loc.origin, data: { t: 'gift', act: 'go', id: g.id } });
      await P.settle(); await P.timers();
      assert.deepEqual(P.calls, SHOWN); assert.equal(P.notes[0].t, '🎁 민지님을 위한 선물 전광판이에요!');
      assert.equal(P.sent.some((s) => s.url.startsWith('/rt/gift/')), false);
    } finally { P.done(); }
    P = await plaza({ at: KST('2026-11-25T19:00:00'), gift: view({ phase: 'live' }) }); // live, but this page's world list has not caught up
    try { P.gift.arrive(); await P.settle(); await P.timers(); assert.deepEqual(P.calls, SHOWN); assert.equal(P.notes[0].t, '🎁 민지님을 위한 선물 전광판이에요!'); } finally { P.done(); }
  });
  it('?gb= in the board\'s main tower minute right after boot (no world copy yet): the fetched view\'s minute puts it on the tower', async () => {
    const TM = KST('2026-11-25T20:30:00'), added = [];
    let on = '';
    let P = await plaza({ at: TM + 1000, gift: view({ phase: 'live', tw: TM }), extra: { towerSlot: (id) => (on === id ? 'MAIN_MID' : '') }, mount: { towerAdd: (e) => { added.push(e); on = e.id; } } });
    try {
      P.gift.arrive(); await P.settle(); await P.timers();
      assert.deepEqual(added.map((e) => [e.id, e.m, e.to]), [['abcd1234', TM, '민지']]);
      assert.deepEqual(P.calls, [['go', 'MAIN_MID'], ['focus', 'MAIN_MID'], ['cheer', 'MAIN_MID']]);
      assert.equal(P.notes[0].t, '🎉 지금 메인 타워에 걸려 있어요!');
    } finally { P.done(); }
    // Its minute is over: the street screen as before, nothing added.
    P = await plaza({ at: TM + 61000, gift: view({ phase: 'live', tw: TM }), extra: { towerSlot: () => '' }, mount: { towerAdd: (e) => added.push(e) } });
    try { P.gift.arrive(); await P.settle(); await P.timers(); assert.deepEqual(P.calls, SHOWN); assert.equal(added.length, 1); } finally { P.done(); }
  });
  it('?gb= before the day only says when it hangs; a board that is gone, hidden or deleted says so; nothing is pinned', async () => {
    let P = await plaza({ at: KST('2026-11-24T12:00:00'), gift: view({ phase: 'before' }) });
    try {
      P.gift.arrive(); await P.settle(); await P.timers();
      assert.deepEqual(P.calls, []); assert.deepEqual(P.notes.map((n) => [n.t, n.k]), [['이 선물 전광판은 11월 25일 (수) 저녁 6시 ~ 자정에 걸려요', 'ok']]);
      P.notes[0].fn(); assert.equal(P.loc.went, '/g/abcd1234', 'a tap goes to its page');
    } finally { P.done(); }
    P = await plaza({ at: KST('2026-11-28T12:00:00'), gift: null }); // the Worker answers 404 for a hidden, deleted or expired board
    try { P.gift.arrive(); await P.settle(); await P.timers(); assert.deepEqual(P.calls, []); assert.deepEqual(P.notes.map((n) => [n.t, n.k]), [['없어졌거나 가려진 선물 전광판이에요', 'err']]); } finally { P.done(); }
    P = await plaza({ at: KST('2026-12-03T00:00:01'), gift: view({ phase: 'after' }) }); // this device's clock is past the page's last day
    try { P.gift.arrive(); await P.settle(); await P.timers(); assert.deepEqual(P.calls, []); assert.equal(P.notes[0].t, '없어졌거나 가려진 선물 전광판이에요'); } finally { P.done(); }
  });
  it('a tap on the reply notice while the plaza is open opens the answered board\'s page over the plaza (the service worker hands this tab the address)', async () => {
    const P = await plaza({ at: KST('2026-11-25T19:00:00'), search: '' });
    try {
      const frames = () => P.doc.body.kids.filter((n) => n.id === 'kts-gift-frame');
      for (const url of ['/?focus=STREET_5', '/?wish=abcdefghij', '/gift', '/g/BAD', 'https://evil.example/g/abcd1234', '']) P.swOn.message({ data: { t: 'push', url } });
      P.swOn.message({ data: { t: 'other', url: '/g/abcd1234' } });
      assert.equal(frames().length, 0, 'only a board page of this site');
      P.swOn.message({ data: { t: 'push', url: '/g/abcd1234?o=1' } });
      assert.equal(frames().length, 1); assert.equal(frames()[0].kids.find((n) => n.tag === 'iframe').src, '/g/abcd1234?o=1&in=1', 'asked as the owner, in the frame');
      P.swOn.message({ data: { t: 'push', url: '/g/abcd1234?o=1' } }); assert.equal(frames().length, 1, 'one frame');
      // The maker is up when the notice is tapped: the board's page takes its place (it used to do nothing).
      P.swOn.message({ data: { t: 'push', url: '/g/wxyz5678?o=1' } });
      assert.equal(frames().length, 1); assert.equal(frames()[0].kids.find((n) => n.tag === 'iframe').src, '/g/wxyz5678?o=1&in=1');
    } finally { P.done(); }
  });
});

describe('the owner page leads with the real video only when the Worker stores videos', () => {
  const g = view(), URL_ = 'https://sq.example/g/' + g.id, REC = '/?gb=' + g.id + '&rec=1';
  const own = (o = {}, store = {}) => pageOf(o.gift || g, KST('2026-11-25T19:00:00'), { rec: o.rec !== false, store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([g.id]), ...store },
    respond: (u) => (u === '/rt/gift/' + g.id ? { ok: true, gift: o.gift || g, own: true, mine: { kids: 0, vd: 0, at: 1, lk: 1, ...(o.re ? { re: o.re } : {}) }, media: !!o.media } : u.endsWith('/interest') ? { ok: true } : null) });
  it('the rule: a video store, no video yet, the board not yet over', () => {
    assert.equal(videoFirst({ media: true, vid: null, phase: 'live' }), true); assert.equal(videoFirst({ media: true, vid: null, phase: 'before' }), true);
    assert.equal(videoFirst({ media: false, vid: null, phase: 'live' }), false, 'no store: the page stays as it is');
    assert.equal(videoFirst({ media: true, vid: { t: 'mp4' }, phase: 'live' }), false); assert.equal(videoFirst({ media: true, vid: null, phase: 'after' }), false);
    assert.equal(videoFirst(), false);
  });
  it('with a video store: the video card first, its button the gold one, and one nudge before the first share; sending is never blocked', async () => {
    let P = own({ media: true });
    try {
      await P.load('giftpage.js');
      assert.deepEqual(P.heads(), ['🎬 15초 축하 영상', '🔗 링크 보내기', '🎬 실사 축하 영상', '✨ 더 크게, 더 오래 걸고 싶다면', '📊 지금까지']);
      const rec = P.btn(/진짜 15초 영상 만들기/);
      assert.equal(rec.textContent, '🎬 광장에서 진짜 15초 영상 만들기 · 약 25초'); assert.equal(rec.className, 'btn gold'); assert.equal(rec.href, REC);
      assert.equal(P.btn(/^공유하기$/).className, 'btn', 'one gold button');
      assert.equal(P.says(/영상을 먼저 만들면/), false);
      await P.press(P.btn(/^공유하기$/));
      assert.deepEqual(P.copied, [], 'the first tap asks once');
      assert.equal(P.says(/^영상을 먼저 만들면 받는 사람이 진짜 광장 영상을 봐요$/), true);
      const first = P.btn(/영상 먼저 만들기/);
      assert.equal(first.textContent, '🎬 영상 먼저 만들기'); assert.equal(first.tag, 'a'); assert.equal(first.href, REC);
      assert.deepEqual(JSON.parse(P.store.kts_gnudge), { [g.id]: 1 });
      await P.press(P.btn(/^그냥 보내기$/));
      assert.equal(P.copied.length, 1); assert.ok(P.copied[0].endsWith(' ' + URL_), 'the share goes on (here: the copy fallback)');
      assert.equal(P.says(/영상을 먼저 만들면/), false, 'the nudge is gone');
      await P.press(P.btn(/^공유하기$/)); assert.equal(P.copied.length, 2, 'never asked twice');
      await P.press(P.btn(/^링크 복사$/)); assert.deepEqual(P.copied[2], URL_);
    } finally { P.done(); }
    P = own({ media: true }, { kts_gnudge: JSON.stringify({ [g.id]: 1 }) }); // the page again later: this board was asked already
    try { await P.load('giftpage.js'); await P.press(P.btn(/^링크 복사$/)); assert.deepEqual(P.copied, [URL_]); assert.equal(P.says(/영상을 먼저 만들면/), false); } finally { P.done(); }
    P = own({ media: true }); // the copy button asks too, and "그냥 보내기" then copies
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/^링크 복사$/));
      assert.deepEqual(P.copied, []); assert.equal(P.says(/영상을 먼저 만들면/), true);
      await P.press(P.btn(/^그냥 보내기$/)); assert.deepEqual(P.copied, [URL_]);
    } finally { P.done(); }
    P = own({ media: true, re: 'rrrrrrrr' });
    try { await P.load('giftpage.js'); assert.deepEqual(P.heads().slice(0, 3), ['💌 답장이 도착했어요', '🎬 15초 축하 영상', '🔗 링크 보내기']); } finally { P.done(); }
  });
  it('without a video store, with a video already there, or after the window: the page is exactly as before', async () => {
    const same = async (P, recText) => {
      try {
        await P.load('giftpage.js');
        assert.deepEqual(P.heads(), ['🔗 링크 보내기', '✨ 더 크게, 더 오래 걸고 싶다면', '🎬 15초 축하 영상', '🎬 실사 축하 영상', '📊 지금까지']);
        const rec = P.btn(/진짜 15초 영상 만들기/);
        if (recText) { assert.equal(rec.textContent, recText); assert.equal(rec.className, 'btn pink'); } else assert.equal(rec, null);
        assert.equal(P.btn(/^공유하기$/).className, 'btn gold');
        await P.press(P.btn(/^공유하기$/));
        assert.equal(P.copied.length, 1, 'shared at once'); assert.equal(P.says(/영상을 먼저 만들면/), false); assert.equal('kts_gnudge' in P.store, false);
      } finally { P.done(); }
    };
    await same(own({ media: false }), '🎬 광장에서 진짜 15초 영상 만들기');
    await same(own({ media: true, gift: view({ vid: { t: 'mp4', at: 1 } }) }), '🎬 광장에서 진짜 15초 영상 만들기');
    await same(own({ media: true, gift: view({ phase: 'after' }) }), '');
    await same(own({ media: true, rec: false }), '🎬 광장에서 진짜 15초 영상 만들기'); // a browser that cannot record: no gold lead, no nudge
  });
});

// 실사 축하 영상 (realvideo.js, docs/superpowers/specs/2026-11-27-real-video-design.md): the owner's card. The compositor itself needs a
// browser (WebGL, a video, MediaRecorder); here only what the page builds and asks for.
describe('the owner page: 🎬 실사 축하 영상', () => {
  it('a new view (back, forward, another board) stops a video being made', () => {
    assert.match(src('giftpage.js'), /function clear\(\) \{[^\n]*REAL_RUN\?\.ctl\.abort\(\)/);
  });
  const g = view();
  const own = (rec) => pageOf(g, KST('2026-11-25T19:00:00'), { rec, store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([g.id]) },
    respond: (u) => (u === '/rt/gift/' + g.id ? { ok: true, gift: g, own: true, mine: { kids: 0, vd: 0, at: 1, lk: 1 }, media: false } : u.endsWith('/index.json') ? { v: 1, plates: [{ id: '03', name: '비 내리는 밤', mp4Bytes: 7, jsonBytes: 9, jpgBytes: 5 }] } : null) });
  const cardOf = (P) => P.all('section').find((n) => n.kids.some((k) => k.tag === 'h2' && k.textContent === '🎬 실사 축하 영상'));
  it('a browser that cannot record says so and suggests Chrome or Safari (the 15-second film needs recording too); nothing is fetched', async () => {
    const P = own(false);
    try {
      await P.load('giftpage.js');
      const c = cardOf(P); assert.ok(c, 'the card is there');
      assert.ok(P.says(/영상 녹화를 지원하지 않아서 실사 영상을 만들 수 없어요\. Chrome이나 Safari 최신 버전에서 열어 주세요\./));
      assert.equal(P.says(/15초 축하 영상을 저장해 보세요/), false);
      assert.equal(P.all('button', c).length, 0, 'no scenes, no make button');
      assert.equal(P.sent.some((s) => s.url.startsWith('/assets/plates/')), false);
    } finally { P.done(); }
  });
  it('an in-app browser (KakaoTalk): open it in Chrome or Safari, with the address to copy, and no maker', async () => {
    const P = own(true);
    try {
      globalThis.navigator.userAgent = 'Mozilla/5.0 (iPhone) AppleWebKit Mobile KAKAOTALK 10.4.5';
      await P.load('giftpage.js');
      const c = cardOf(P);
      assert.ok(P.says(/앱 안의 브라우저에서는 영상을 저장하거나 보낼 수 없어요\. 이 페이지를 Chrome이나 Safari에서 열어 주세요\./));
      assert.equal(P.all('button', c).some((n) => /scene/.test(n.className)), false, 'no scenes');
      await P.press(P.btn(/이 페이지 주소 복사/, c));
      assert.deepEqual(P.copied, ['https://sq.example/g/' + g.id]); assert.ok(P.says(/주소를 복사했어요/));
      assert.equal(P.sent.some((s) => s.url.startsWith('/assets/plates/')), false);
    } finally { P.done(); }
  });
  it('seven scenes with their stills; 만들기 waits for a scene; index.json may rename one', async () => {
    const P = own(true);
    try {
      await P.load('giftpage.js');
      const c = cardOf(P), scenes = P.all('button', c).filter((n) => /\bscene\b/.test(n.className));
      assert.equal(scenes.length, 7);
      assert.deepEqual(scenes.map((n) => P.all('img', n)[0].attrs.src), ['01', '02', '03', '04', '05', '06', '07'].map((id) => '/assets/plates/plate-' + id + '.jpg' + (id === '03' ? '?v=5' : '')), 'versioned by index.json where it has the size');
      assert.deepEqual(scenes.map((n) => n.textContent), ['정면 밤', '타워', '비 내리는 밤', '연말 군중', '내 손 휴대폰', '코너 입체', '블루아워'], 'the name from index.json');
      assert.ok(scenes.every((n) => n.attrs['aria-pressed'] === 'false' && n.className === 'chip scene'));
      const make = P.btn(/장면을 먼저 골라 주세요/, c); assert.ok(make && make.disabled && make.className === 'btn gold');
      assert.ok(P.says(/서버에는 올리지 않아요/), 'it says the video stays on the device');
      assert.equal(P.sent.filter((s) => s.url.startsWith('/assets/plates/')).map((s) => s.url).join(), '/assets/plates/index.json', 'only the list until a scene is picked');
    } finally { P.done(); }
  });
  it('a pick fetches that scene (its track and video) and the occasion\'s music, counts real_pick once, and says when the scene could not be had', async () => {
    const P = own(true);
    try {
      await P.load('giftpage.js');
      const c = cardOf(P), rain = P.all('button', c).find((n) => n.textContent === '비 내리는 밤'), before = P.sent.length;
      await P.press(rain); await P.settle();
      assert.equal(rain.attrs['aria-pressed'], 'true');
      const got = P.sent.map((s) => s.url).filter((u) => u.startsWith('/assets/plates/') && !u.endsWith('index.json')).sort();
      assert.deepEqual(got, ['/assets/plates/music-bday.m4a', '/assets/plates/plate-03.json?v=7-9', '/assets/plates/plate-03.mp4?v=7-9'], 'the video and its corners as one version');
      assert.equal(P.seen(g.id, 'real_pick'), true);
      assert.ok(P.says(/‘비 내리는 밤’ 장면을 받지 못했어요/), 'the fake server has no such file: said, and a press again retries');
      assert.ok(P.btn(/장면을 다시 눌러 주세요/, c).disabled);
      assert.equal(P.sent.slice(before).some((s) => s.method !== 'GET'), false, 'nothing of the video goes to the server');
      await P.press(rain); await P.settle();
      assert.equal(P.sent.filter((s) => s.url === '/assets/plates/music-bday.m4a').length, 2, 'a music download that failed is asked again');
    } finally { P.done(); }
  });
});


describe('attribution (E2), the price ladder (E1), quiet hours', () => {
  it('keeps a ref 7 days', () => {
    assert.equal(refOf('abcd1234'), 'abcd1234'); assert.equal(refOf('ABCD1234'), ''); assert.equal(refOf('abc'), '');
    assert.equal(keptRef(JSON.stringify({ id: 'abcd1234', at: 1000 }), 1000 + REF_MS - 1), 'abcd1234');
    assert.equal(keptRef(JSON.stringify({ id: 'abcd1234', at: 1000 }), 1000 + REF_MS), '');
    assert.equal(keptRef('junk', 0), '');
  });
  it('the ladder is the report\'s: free first and the default, 3,900 / 7,900 (recommended) / 14,900, VAT included, no fake scarcity', () => {
    assert.deepEqual(TIERS.map((t) => t.price), [0, 3900, 7900, 14900]);
    assert.equal(TIERS.filter((t) => t.best).map((t) => t.t).join(), '2');
    assert.equal(TIERS.filter((t) => /커피 한 잔/.test(t.tag)).map((t) => t.t).join(), '1', 'the coffee words only on the 3,900 tier');
    assert.match(TIER_NOTE, /부가세 포함/); assert.match(TIER_ASK, /결제는 준비 중이에요 · 열리면 알려 드릴까요\?/);
    assert.equal(/퍼레이드|24시간/.test(JSON.stringify(TIERS)), false, 'no parade and no 24-hour big screen: the code has neither (b2c-rules.test.mjs)');
    assert.equal(/남은|마감|한정/.test(JSON.stringify(TIERS)), false);
    assert.equal(won(7900), '7,900원'); assert.equal(won(0), '0원');
    const page = fs.readFileSync(new URL('../giftpage.js', import.meta.url), 'utf8');
    assert.match(page, /let pick = 0;/, 'the page starts on the free tier');
  });
  it('no advertising push from 21:00 to 08:00 KST', () => {
    assert.equal(quietNow(KST('2026-11-23T20:59:59')), false);
    assert.equal(quietNow(KST('2026-11-23T21:00:00')), true);
    assert.equal(quietNow(KST('2026-11-24T07:59:59')), true);
    assert.equal(quietNow(KST('2026-11-24T08:00:00')), false);
  });
  it('days are KST', () => { assert.equal(kstDay(KST('2026-11-23T23:59:59')), '2026-11-23'); assert.equal(kstDay(KST('2026-11-24T00:00:00')), '2026-11-24'); assert.equal(dayStart('2026-11-24'), KST('2026-11-24T00:00:00')); });
});

describe('the video', () => {
  it('knows MP4 and WebM by their bytes, nothing else', () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(videoKind(mp4), 'mp4'); assert.equal(videoKind(webm), 'webm');
    assert.equal(videoKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), '');
    assert.equal(videoKind(new Uint8Array(3)), '');
  });
  it('serves byte ranges', () => {
    assert.deepEqual(rangeOf('bytes=0-99', 1000), { offset: 0, length: 100 });
    assert.deepEqual(rangeOf('bytes=900-', 1000), { offset: 900, length: 100 });
    assert.deepEqual(rangeOf('bytes=-100', 1000), { offset: 900, length: 100 });
    assert.deepEqual(rangeOf('bytes=990-5000', 1000), { offset: 990, length: 10 });
    assert.equal(rangeOf('bytes=1000-', 1000), 'bad'); assert.equal(rangeOf('', 1000), null); assert.equal(rangeOf('items=0-1', 1000), null);
  });
  it('records MP4 where the browser can, WebM otherwise', () => {
    assert.equal(pickRecordType((t) => t.startsWith('video/webm')), 'video/webm;codecs=vp9');
    assert.equal(pickRecordType((t) => t === 'video/mp4'), 'video/mp4');
    assert.equal(pickRecordType(() => false), '');
  });
});

describe('the reply notice opens the board as its owner on any device of the account (?o=1)', () => {
  const g = view();
  const page = (own) => pageOf(g, KST('2026-11-25T19:00:00'), { search: '?o=1',
    respond: (u) => (u === '/rt/gift/' + g.id ? { ok: true, gift: g, own, ...(own ? { mine: { kids: 1, vd: 0, at: 1, lk: 1, re: 'rrrrrrrr' }, media: false } : {}) } : u.endsWith('/interest') ? { ok: true } : null) });
  it('the owner, on a device that did not make the board: the owner page with the reply card, and the device remembers the board', async () => {
    const P = page(true);
    try {
      await P.load('giftpage.js');
      assert.equal(P.heads()[0], '💌 답장이 도착했어요');
      assert.deepEqual(JSON.parse(P.store.kts_gmine), [g.id]);
      assert.equal(P.sent.find((x) => x.url === '/rt/gift/' + g.id).auth, 'Bearer g1.test.token', 'the Worker decides who the owner is');
    } finally { P.done(); }
  });
  it('anyone else with that address: the public page, nothing remembered', async () => {
    const P = page(false);
    try {
      await P.load('giftpage.js');
      assert.equal(P.heads().includes('💌 답장이 도착했어요'), false);
      assert.ok(P.heads().includes('💌 롤링페이퍼'), P.heads().join(' | '));
      assert.equal('kts_gmine' in P.store, false);
    } finally { P.done(); }
  });
  it('without ?o=1 a device that did not make the board does not ask as the owner (as before)', async () => {
    const P = pageOf(g, KST('2026-11-25T19:00:00'), { respond: () => null });
    try { await P.load('giftpage.js'); assert.equal(P.sent.some((x) => x.url === '/rt/gift/' + g.id && x.auth), false); } finally { P.done(); }
  });
});

// ---- 점등식 on the recipient page (giftpage.js), the owner's share line, the admin columns -------------------------------------------
import { CER_TEXT, cerInvite, cerButton, revealAt, pageLook, hiddenWords } from '../giftrules.js';
describe('점등식 on the recipient page', () => {
  const g = view(), ID = g.id, URL_ = 'https://sq.example/g/' + ID; // the 25th, 18:00: a fixed start
  const cerBox = (P) => P.all('div').find((n) => n.className === 'cer') || null;
  const cerCtl = (P) => cerBox(P)?.kids[0] || null;
  const cerLine = (P) => cerBox(P)?.kids[1] || null;
  const sticky = (P) => P.all('div').find((n) => n.className === 'sticky');
  it('the pure button and invitation take the localhost seam\'s start in place of the board\'s', () => {
    const at = KST('2026-11-20T12:00:00');
    assert.equal(cerButton(g, at).act, 'early');
    const b = cerButton(g, at, { start: at + 75000 });
    assert.deepEqual(b, { label: '🎆 점등식 들어가기 · 01:15 남음', act: 'go', href: '/?gb=' + ID + '&cer=1' });
    assert.equal(cerButton(view({ a: KST('2026-11-25T12:20:00') }), at, { start: at - 30000 }).act, 'go', 'any board, even a "지금" one');
    assert.deepEqual(cerInvite(g, URL_, 0), cerInvite(g, URL_));
    assert.match(cerInvite(g, URL_, KST('2026-11-20T12:01:15')).text, /^11월 20일 12:01, /);
  });
  it('before the day: a gold button under the countdown; a tap says 10분 전부터 and opens the share sheet with the invitation', async () => {
    const P = pageOf(g, KST('2026-11-20T12:00:00'));
    try {
      globalThis.navigator.share = async (o) => { P.shared.push(o); };
      await P.load('giftpage.js');
      const ctl = cerCtl(P), box = cerBox(P), col = sticky(P);
      assert.ok(ctl, 'the ceremony button');
      assert.deepEqual([ctl.tag, ctl.className, ctl.textContent, ctl.attrs.type], ['button', 'btn gold', '🎆 점등식 같이 보기 · 11월 25일 18:00', 'button']);
      assert.equal(col.kids[col.kids.indexOf(box) - 1].className, 'card', 'right under the countdown card');
      assert.equal(col.kids[col.kids.indexOf(box) + 1].tag, 'canvas', 'above the preview');
      assert.equal(cerLine(P).textContent, '');
      await P.press(ctl);
      assert.equal(cerLine(P).textContent, CER_TEXT.early); assert.equal(cerLine(P).attrs.role, 'status');
      assert.deepEqual(P.shared, [cerInvite(g, URL_)]);
      assert.equal(P.shared[0].title, '🎆 민지님 선물 전광판 점등식');
      assert.equal(P.loc.went, undefined, 'nothing navigates');
    } finally { P.done(); }
  });
  it('without a share sheet the invitation is copied; a sheet the person closes says nothing more', async () => {
    let P = pageOf(g, KST('2026-11-20T12:00:00'));
    try {
      await P.load('giftpage.js'); await P.press(cerCtl(P));
      const inv = cerInvite(g, URL_);
      assert.deepEqual(P.copied, [inv.text + ' ' + inv.url]);
      assert.equal(cerLine(P).textContent, CER_TEXT.early + ' 초대 문구를 복사했어요. 카카오톡에 붙여 넣어 보내세요.');
    } finally { P.done(); }
    P = pageOf(g, KST('2026-11-20T12:00:00'));
    try {
      globalThis.navigator.share = async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); };
      await P.load('giftpage.js'); await P.press(cerCtl(P));
      assert.deepEqual(P.copied, []); assert.equal(cerLine(P).textContent, CER_TEXT.early);
    } finally { P.done(); }
  });
  it('inside the window: a link into the plaza whose time left ticks; in the board\'s own view it stands under the where line while the rest waits for the film', async () => {
    let P = pageOf(g, KST('2026-11-25T17:50:00'));
    try {
      await P.load('giftpage.js');
      const ctl = cerCtl(P), col = sticky(P);
      assert.deepEqual([ctl.tag, ctl.className, ctl.href, ctl.textContent], ['a', 'btn gold', '/?gb=' + ID + '&cer=1', '🎆 점등식 들어가기 · 10:00 남음']);
      P.skew += 1000; P.tick();
      assert.equal(cerCtl(P).textContent, '🎆 점등식 들어가기 · 09:59 남음');
      // G6: a 점등식 board keeps the before look until its start, so before 18:00 the button stands under the countdown card.
      assert.equal(col.kids[col.kids.indexOf(cerBox(P)) - 1].className, 'card');
      await P.press(cerCtl(P));
      assert.equal(P.seen(ID, 'go'), true, 'the plaza button\'s beacon'); assert.deepEqual(P.posted, []);
    } finally { P.done(); }
    P = pageOf(g, KST('2026-11-25T18:00:30')); // the lit minutes: the board's own view
    try {
      await P.load('giftpage.js');
      const ctl = cerCtl(P), col = sticky(P);
      const box = cerBox(P), where = col.kids[col.kids.indexOf(box) - 1];
      assert.deepEqual([where.tag, where.className], ['p', 'sub'], 'directly under the where line');
      assert.ok(col.kids.indexOf(box) < col.kids.indexOf(col.kids.find((n) => /^stage/.test(n.className))), 'above the film');
      const acts = col.kids.find((n) => n.className === 'stack');
      assert.equal(acts.hidden, true, 'the other buttons wait for the film'); assert.equal(P.shown(ctl), true);
    } finally { P.done(); }
  });
  it('the first two minutes after the start: 방금 켜졌어요; then no button, and the page as before', async () => {
    let P = pageOf(g, KST('2026-11-25T18:00:30'));
    try { await P.load('giftpage.js'); assert.deepEqual([cerCtl(P).tag, cerCtl(P).textContent], ['a', '🎆 방금 켜졌어요 · 점등식 보러 가기']); } finally { P.done(); }
    P = pageOf(g, KST('2026-11-25T18:01:59.500'));
    try {
      await P.load('giftpage.js'); assert.ok(cerCtl(P));
      P.skew += 1000; P.tick();
      assert.equal(cerBox(P), null, 'gone once the late window is over'); assert.equal(P.btn(/점등식/), null);
      assert.ok(P.btn(/직접 가서 보기/) || P.btn(/영상 건너뛰기/), 'the ordinary page stays');
    } finally { P.done(); }
    P = pageOf(g, KST('2026-11-25T18:02:00'));
    try { await P.load('giftpage.js'); assert.equal(cerBox(P), null); assert.equal(P.btn(/점등식/), null); } finally { P.done(); }
  });
  it('a "지금" board, a page without data and a gone board have no ceremony button', async () => {
    const now = view({ a: KST('2026-11-25T12:20:00'), b: KST('2026-11-25T18:20:00') });
    let P = pageOf(now, KST('2026-11-25T12:30:00'));
    try { await P.load('giftpage.js'); assert.equal(cerBox(P), null); assert.equal(P.btn(/점등식/), null); } finally { P.done(); }
    P = pageOf(view({ phase: 'gone' }), KST('2026-11-25T17:55:00'));
    try { await P.load('giftpage.js'); assert.equal(cerBox(P), null); } finally { P.done(); }
    P = fakeDom({ path: '/g/' + ID, data: null, at: KST('2026-11-25T17:55:00') });
    try { await P.load('giftpage.js'); assert.equal(P.loc.reloads, 1, 'as before: no data, the page asks again'); assert.equal(cerBox(P), null); } finally { P.done(); }
  });
  it('budget hard (the page data says hard): the label stays, the button enters nothing and says the plaza is busy', async () => {
    const P = fakeDom({ path: '/g/' + ID, data: { id: ID, gift: g, now: KST('2026-11-25T17:55:00'), media: false, hard: true }, at: KST('2026-11-25T17:55:00'), store: { masil_gt: GUEST() } });
    try {
      await P.load('giftpage.js');
      const ctl = cerCtl(P);
      assert.deepEqual([ctl.tag, ctl.className, ctl.textContent, ctl.href || ''], ['button', 'btn gold', '🎆 점등식 들어가기 · 05:00 남음', '']);
      await P.press(ctl);
      assert.equal(cerLine(P).textContent, CER_TEXT.busy); assert.equal(cerLine(P).attrs.role, 'alert');
      assert.equal(P.loc.went, undefined); assert.deepEqual(P.posted, []); assert.equal(P.seen(ID, 'go'), false);
    } finally { P.done(); }
  });
  it('sent back from the plaza (?cer=busy, ?cer=early): the reason once under the button, and the address drops cer', async () => {
    for (const [why, at] of [['busy', KST('2026-11-25T17:55:00')], ['early', KST('2026-11-25T17:30:00')]]) {
      const P = pageOf(g, at, { search: '?cer=' + why });
      try {
        await P.load('giftpage.js');
        assert.equal(cerLine(P).textContent, CER_TEXT[why], why); assert.equal(cerLine(P).attrs.role, 'status');
        assert.equal(P.loc.search, '', 'a reload does not say it again'); assert.equal(P.loc.pathname, '/g/' + ID);
      } finally { P.done(); }
    }
    const P = pageOf(g, KST('2026-11-25T17:55:00'), { search: '?cer=nope' });
    try { await P.load('giftpage.js'); assert.equal(cerLine(P).textContent, ''); assert.equal(P.loc.search, '?cer=nope', 'not a reason: left alone'); } finally { P.done(); }
  });
  it('over the plaza (?in=1): the button tells the plaza instead of loading a second one', async () => {
    const P = pageOf(g, KST('2026-11-25T17:55:00'), { search: '?in=1', embed: true });
    try {
      await P.load('giftpage.js');
      await P.press(cerCtl(P));
      assert.deepEqual(P.posted, [{ t: 'gift', act: 'cer', id: ID }]);
    } finally { P.done(); }
  });
  it('the owner\'s 공유하기 adds the ceremony line until the start; a "지금" board never has it; admin lists the two beacons', async () => {
    const LINE = ' 🎆 점등식 11월 25일 18:00에 같이 봐요!', BASE = '🎂 민지님을 위한 선물 전광판이 뉴욕 타임스퀘어 가상 광장에 걸려요! 친구들 메시지도 남겨 주세요 👉';
    const owned = (b, at, made = KST('2026-11-20T10:00:00')) => pageOf(b, at, { store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([b.id]) },
      respond: (u) => (u === '/rt/gift/' + b.id ? { ok: true, gift: b, own: true, mine: { kids: 0, vd: 0, at: made, lk: 1 }, media: false } : u.endsWith('/interest') ? { ok: true } : null) });
    const shareText = async (b, at, made, sheet = true) => {
      const P = owned(b, at, made);
      try {
        if (sheet) globalThis.navigator.share = async (o) => { P.shared.push(o); };
        await P.load('giftpage.js'); await P.press(P.btn(/^공유하기$/));
        return sheet ? P.shared[0].text : P.copied[0];
      } finally { P.done(); }
    };
    assert.equal(await shareText(g, KST('2026-11-24T12:00:00')), BASE + LINE, 'D-1: the line after the sentence, before the address');
    assert.equal(await shareText(g, KST('2026-11-24T12:00:00'), undefined, false), BASE + LINE + ' ' + URL_, 'copied: the line, then the address');
    assert.equal(await shareText(g, KST('2026-11-25T18:05:00')), BASE, 'after the start: without it');
    const now = view({ a: KST('2026-11-25T12:00:00'), b: KST('2026-11-25T18:00:00') });
    assert.equal(await shareText(now, KST('2026-11-25T12:05:00'), KST('2026-11-25T12:04:00')), BASE, 'made at its start ("지금" in the first 10 minutes after 12:00): the owner\'s read says so');
    assert.equal(await shareText(view({ a: KST('2026-11-25T12:20:00'), b: KST('2026-11-25T18:20:00') }), KST('2026-11-25T12:21:00'), KST('2026-11-25T12:20:30')), BASE);
    assert.match(src('admin-gift.js'), /\['ev:go', '직접 가서 봄'\], \['ev:cer', '점등식 온 기기'\], \['ev:cershot', '단체 사진 저장·공유'\], /);
  });
  it('the localhost seam: ?cerin=<s> on a local host runs the button against a start that far from load and carries the seconds on; elsewhere nothing', async () => {
    const at = KST('2026-11-20T12:00:00'), on = async (host, search) => { const P = pageOf(g, at, { search }); P.loc.hostname = host; await P.load('giftpage.js'); return P; };
    let P = await on('localhost', '?cerin=75');
    try {
      assert.deepEqual([cerCtl(P).tag, cerCtl(P).textContent, cerCtl(P).href], ['a', '🎆 점등식 들어가기 · 01:15 남음', '/?gb=' + ID + '&cer=1&cerin=75']);
      P.skew += 1000; P.tick();
      assert.deepEqual([cerCtl(P).textContent, cerCtl(P).href], ['🎆 점등식 들어가기 · 01:14 남음', '/?gb=' + ID + '&cer=1&cerin=74']);
    } finally { P.done(); }
    P = await on('127.0.0.1', '?cerin=-30');
    try { assert.deepEqual([cerCtl(P).textContent, cerCtl(P).href], ['🎆 방금 켜졌어요 · 점등식 보러 가기', '/?gb=' + ID + '&cer=1&cerin=-30']); } finally { P.done(); }
    P = await on('plaza.localhost', '?cerin=700');
    try { assert.deepEqual([cerCtl(P).tag, cerCtl(P).textContent], ['button', '🎆 점등식 같이 보기 · 11월 20일 12:11']); } finally { P.done(); }
    P = await on('studio.wishboard.workers.dev', '?cerin=75');
    try { assert.deepEqual([cerCtl(P).tag, cerCtl(P).textContent], ['button', '🎆 점등식 같이 보기 · 11월 25일 18:00'], 'the real phase'); assert.equal(cerCtl(P).href || '', ''); } finally { P.done(); }
    P = pageOf(g, KST('2026-11-25T17:55:00'), { search: '?cerin=75' }); P.loc.hostname = 'studio.wishboard.workers.dev';
    try { await P.load('giftpage.js'); assert.equal(cerCtl(P).href, '/?gb=' + ID + '&cer=1', 'no cerin on the live site'); } finally { P.done(); }
  });
});

describe('점등식: a ceremony board stays hidden until the lighting (G6)', () => {
  const g = view(), A = g.a; // 18:00 on the 25th
  const now = view({ a: KST('2026-11-25T12:20:00'), b: KST('2026-11-25T18:20:00') }); // a "지금" board (no fixed start)
  const plain = { id: 'pppppppp', day: '2026-11-25', a: KST('2026-11-25T12:20:00'), b: KST('2026-11-25T18:20:00') };
  it('the reveal time and the page\'s view: the start for a ceremony board, 00:00 of the day for any other', () => {
    assert.equal(revealAt(g), A); assert.equal(revealAt(now), KST('2026-11-25T00:00:00')); assert.equal(revealAt(g, 12345), 12345, 'the localhost seam');
    for (const [t, want] of [['2026-11-24T12:00:00', 'before'], ['2026-11-25T00:00:00', 'before'], [A - 1, 'before'], [A, 'live'], [g.b - 1, 'live'], [g.b, 'after'], ['2026-11-28T12:00:00', 'after']]) {
      const at = typeof t === 'number' ? t : KST(t);
      assert.equal(pageLook(g, at), want, String(t));
    }
    assert.equal(pageLook(now, KST('2026-11-24T23:59:59')), 'before'); assert.equal(pageLook(now, KST('2026-11-25T00:00:00')), 'day', '"지금": the day as before');
    assert.equal(pageLook(now, now.a), 'live');
    assert.equal(plazaLook(g, KST('2026-11-25T00:00:00')), 'wait', 'no preview in the plaza before the lighting'); assert.equal(plazaLook(g, A - 1), 'wait');
    assert.equal(plazaLook(g, A), 'live'); assert.equal(plazaLook(g, g.b), 'replay', 'after the window: the replay as before');
    assert.equal(plazaLook(plain, KST('2026-11-25T00:00:00')), 'replay', 'no fixed start: the preview from the day as before');
  });
  it('the words of the hidden view: D-1, 00:00 of the day, five minutes before; a board without a fixed start keeps today\'s', () => {
    assert.deepEqual(hiddenWords(g, KST('2026-11-24T12:00:00')), { label: '그날까지', count: 'D-1', fine: '11월 25일 (수) 18:00에 전광판이 켜지면 축하 영상이 함께 열려요.', hush: '그날 공개돼요 🤫' });
    assert.deepEqual(hiddenWords(g, KST('2026-11-25T00:00:00')), { label: '켜지기까지', count: '18시간 0분', fine: '오늘 18:00에 전광판이 켜지면 축하 영상이 함께 열려요.', hush: '18:00에 공개돼요 🤫' });
    assert.deepEqual(hiddenWords(g, KST('2026-11-25T17:55:00')), { label: '켜지기까지', count: '5분 0초', fine: '오늘 18:00에 전광판이 켜지면 축하 영상이 함께 열려요.', hush: '18:00에 공개돼요 🤫' });
    assert.deepEqual(hiddenWords(now, KST('2026-11-23T12:00:00')), { label: '그날까지', count: 'D-2', fine: '11월 25일 (수)이 되면 축하 영상과 친구들의 메시지가 함께 열려요.', hush: '그날 공개돼요 🤫' });
  });
  const stageOf = (P) => P.all('div').find((n) => /^stage/.test(n.className)) || null;
  const cerCtl = (P) => P.all('div').find((n) => n.className === 'cer')?.kids[0];
  const words = (P) => { const c = P.all('section').find((n) => n.kids[0]?.className === 'label'); return c ? [c.kids[0].textContent, c.kids[1].textContent, c.kids[2].textContent] : null; };
  it('on its day before the start a visitor sees the before look: no film, no message, the countdown to the lighting and the ceremony button', async () => {
    for (const [t, want] of [['2026-11-25T00:00:00', ['켜지기까지', '18시간 0분', '오늘 18:00에 전광판이 켜지면 축하 영상이 함께 열려요.']], ['2026-11-25T17:55:00', ['켜지기까지', '5분 0초', '오늘 18:00에 전광판이 켜지면 축하 영상이 함께 열려요.']],
      ['2026-11-24T12:00:00', ['그날까지', 'D-1', '11월 25일 (수) 18:00에 전광판이 켜지면 축하 영상이 함께 열려요.']]]) {
      const P = pageOf(g, KST(t));
      try {
        await P.load('giftpage.js');
        assert.deepEqual(P.heads('h1'), ['🎂 민지님을 위한 선물 전광판'], t);
        assert.equal(stageOf(P), null, 'no film'); assert.equal(P.says(/생일 축하해!/), false, 'the message is nowhere on the page');
        assert.equal(P.heads().includes('📺 광장에 걸린 글'), false); assert.equal(P.btn(/^🗽/), null, 'no plaza preview');
        assert.equal(P.btn(/답장|고마워 전광판/), null); assert.ok(P.btn(/점등식/), 'the ceremony button');
        P.tick(); assert.deepEqual(words(P), want, t);
      } finally { P.done(); }
    }
  });
  it('at the start the page turns into the board by itself (the lighting is the reveal); from then on it is today\'s page', async () => {
    let P = pageOf(g, KST('2026-11-25T17:59:59.500'));
    try {
      await P.load('giftpage.js'); assert.equal(stageOf(P), null);
      P.skew += 1000; P.tick();
      assert.ok(stageOf(P), 'the film'); assert.ok(P.heads().includes('📺 광장에 걸린 글')); assert.equal(P.says(/^생일 축하해!$/), true);
      assert.equal(cerCtl(P).textContent, '🎆 방금 켜졌어요 · 점등식 보러 가기');
      await P.press(P.btn(/영상 건너뛰기/)); assert.equal(P.btn(/^🗽/).textContent, '🗽 직접 가서 보기');
    } finally { P.done(); }
    P = pageOf(g, KST('2026-11-26T09:00:00'));
    try { await P.load('giftpage.js'); assert.ok(stageOf(P)); } finally { P.done(); }
  });
  it('a board without a fixed start on its day, and the owner\'s own page, are as they were; the owner\'s "what the recipient sees" follows the recipient', async () => {
    let P = pageOf(now, KST('2026-11-25T12:10:00'));
    try { await P.load('giftpage.js'); assert.ok(stageOf(P), '"지금" on its day: the film as before'); assert.equal(P.says(/^생일 축하해!$/), true); } finally { P.done(); }
    P = pageOf(g, KST('2026-11-25T10:00:00'), { store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([g.id]) },
      respond: (u) => (u === '/rt/gift/' + g.id ? { ok: true, gift: g, own: true, mine: { kids: 0, vd: 0, at: 1, lk: 1 }, media: false } : u.endsWith('/interest') ? { ok: true } : null) });
    try {
      await P.load('giftpage.js');
      assert.ok(stageOf(P), 'the owner\'s preview film'); assert.ok(P.heads().includes('🔗 링크 보내기'));
      await P.press(P.btn(/받는 사람에게 보이는 화면/));
      assert.deepEqual(P.heads('h1'), ['🎂 민지님을 위한 선물 전광판']); assert.equal(stageOf(P), null, 'what a recipient sees now');
      assert.ok(P.btn(/내 관리 화면으로/));
    } finally { P.done(); }
  });
});

// ---- gift.html's sheet, read as rules -------------------------------------------------------------------------------------------
// The pages are not opened here, so what a phone needs from the sheet is checked on its text: a pressed state for every control,
// places to press of 44px, no text under 12px, and the contrast of every text colour on the lightest surface it can sit on.
const SHEET = (() => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(src('gift.html'))[1].replace(/\/\*[\s\S]*?\*\//g, '');
  // @media blocks apart: their rules hold only where the query does.
  let base = ''; const media = [];
  for (let i = 0; i < css.length;) {
    const at = css.indexOf('@media', i);
    if (at < 0) { base += css.slice(i); break; }
    base += css.slice(i, at);
    const open = css.indexOf('{', at); let j = open + 1;
    for (let depth = 1; depth && j < css.length; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0;
    media.push({ q: css.slice(at + 6, open).trim(), body: css.slice(open + 1, j - 1) }); i = j;
  }
  const parse = (text) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sels: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    decl: Object.fromEntries(m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const k = d.indexOf(':'); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; })),
  }));
  const rules = parse(base), vars = rules.find((r) => r.sels.includes(':root')).decl;
  const val = (v) => String(v ?? '').replace(/var\((--[\w-]+)\)/g, (_, k) => vars[k] ?? '');
  /** A property of exactly this selector (the last rule outside @media that names it), var() resolved; undefined when it has none. */
  const get = (sel, prop) => { let out; for (const r of rules) if (r.sels.includes(sel) && prop in r.decl) out = r.decl[prop]; return out === undefined ? undefined : val(out); };
  return { css, rules, media: media.map((m) => ({ q: m.q, rules: parse(m.body) })), vars, val, get };
})();
const px = (v) => { const m = /^(-?[\d.]+)px$/.exec(String(v ?? '').trim()); return m ? Number(m[1]) : NaN; };
// Colours as [r, g, b, alpha]; WCAG 2 relative luminance and contrast.
const rgb = (c) => {
  const s = String(c).trim(); let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) { const x = m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1]; return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16), 1]; }
  m = /^rgba?\(([^)]+)\)$/i.exec(s); assert.ok(m, 'a colour: ' + c);
  const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1];
};
const colours = (v) => (String(v ?? '').match(/#[0-9a-f]{3,6}\b|rgba?\([^)]*\)/gi) || []).map(rgb); // every colour of a value (a gradient's stops)
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const lay = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1); // a see-through fill over an opaque one
const WHITE = [255, 255, 255, 1], BLACK = [0, 0, 0, 1];
// The surfaces text sits on. The page is its darkest colour with two glows over it: the lightest the page can be is the lighter glow's
// own colour (a bound: the glows' centres are off the screen). A card is the card fill over that, and what lies in a card over the card.
const SURF = (() => {
  const S = SHEET, fill = (sel, under) => lay(colours(S.get(sel, 'background'))[0], under);
  const page = colours(S.get('body', 'background')).reduce((a, b) => (lum(b) > lum(a) ? b : a)), card = lay(rgb(S.vars['--card']), page);
  return {
    page, card, ask: fill('.ask', card), chip: fill('.chip', card), chipOn: fill('.chip[aria-pressed=true]', card), btn: fill('.btn', card), field: fill('textarea', card),
    tier: fill('.tier', card), tierOn: fill('.tier[aria-checked=true]', card), lock: fill('.lock', card), link: fill('.link', card), stat: fill('.stats div', card),
    tag: fill('.tag', page), tagLive: fill('.tag.live', page), pressed: lay(rgb(S.vars['--press']), card),
    gold: colours(S.get('.btn.gold', 'background')), pink: colours(S.get('.btn.pink', 'background')), best: colours(S.get('.tier .best', 'background')),
    notes: ['.note', '.note:nth-child(3n+2)', '.note:nth-child(3n)'].map((s) => colours(S.get(s, 'background'))[0]),
  };
})();

describe('gift.html on a phone: pressed states, places to press, text size and contrast (read from the sheet)', () => {
  const S = SHEET;
  it('every control has a pressed state that changes its fill the moment it is touched, not only its size', () => {
    const PRESSED = ['.btn:not(:disabled):active', '.btn.gold:not(:disabled):active', '.btn.pink:not(:disabled):active', '.chip:not(:disabled):active', '.chip[aria-pressed=true]:not(:disabled):active',
      '.sw:active', '.tier:active', '.tier[aria-checked=true]:active', '.linkbtn:active', '.brand:active', '.note .rp:active', '.stage .play:active span'];
    for (const sel of PRESSED) {
      const d = S.rules.filter((r) => r.sels.includes(sel)).map((r) => r.decl);
      assert.ok(d.length, sel + ': a pressed rule');
      assert.ok(d.some((x) => x.background || x['box-shadow'] || x.color), sel + ': more than a change of size');
    }
    // At once: the fade of the rest state is switched off while the finger is down, and the rest state fades back (a quick tap is seen).
    const instant = S.rules.find((r) => r.decl.transition === 'none' && r.sels.includes('.btn:active'));
    for (const sel of ['.btn:active', '.chip:active', '.sw:active', '.tier:active', '.linkbtn:active']) assert.ok(instant.sels.includes(sel), sel + ': no fade in');
    const fade = S.rules.find((r) => /background-color \.25s/.test(r.decl.transition || '') && r.sels.includes('.btn'));
    for (const sel of ['.btn', '.chip', '.sw', '.tier', '.linkbtn']) assert.ok(fade.sels.includes(sel), sel + ': fades back');
    assert.match(fade.decl.transition, /box-shadow \.25s/, 'the gold and pink washes are shadows: they fade too');
    // How far each fill moves (rest against pressed, as a contrast ratio). The plaza's gold moved 1.17:1 and nobody saw it.
    const press = rgb(S.vars['--press']);
    const moved = {
      btn: ratio(SURF.btn, SURF.pressed), chip: ratio(SURF.chip, SURF.pressed),
      chipOn: ratio(SURF.chipOn, lay(colours(S.get('.chip[aria-pressed=true]:not(:disabled):active', 'background'))[0], SURF.card)),
      tier: ratio(SURF.tier, lay(colours(S.get('.tier:active', 'background'))[0], SURF.card)),
      tierOn: ratio(SURF.tierOn, lay(colours(S.get('.tier[aria-checked=true]:active', 'background'))[0], SURF.card)),
      gold: Math.min(...SURF.gold.map((c) => ratio(c, lay(rgb(S.vars['--gold-press']), c)))), pink: Math.min(...SURF.pink.map((c) => ratio(c, lay(rgb(S.vars['--pink-press']), c)))),
    };
    for (const [k, v] of Object.entries(moved)) assert.ok(v >= 1.4, `${k}: the pressed fill is ${v.toFixed(2)}:1 from the rest fill`);
    assert.equal(press[3] >= 0.2, true);
    // The words on a pressed button stay readable.
    const ink = { gold: rgb(S.get('.btn.gold', 'color')), pink: rgb(S.get('.btn.pink', 'color')), text: rgb(S.vars['--text']) };
    for (const c of SURF.gold) assert.ok(ratio(ink.gold, lay(rgb(S.vars['--gold-press']), c)) >= 4.5, 'pressed gold');
    for (const c of SURF.pink) assert.ok(ratio(ink.pink, lay(rgb(S.vars['--pink-press']), c)) >= 4.5, 'pressed pink');
    assert.ok(ratio(ink.text, SURF.pressed) >= 4.5, 'pressed plain button');
    // The washes of the gold and pink buttons are the pressed rules' inset shadows, there (clear) at rest so they can fade.
    assert.match(S.get('.btn.gold', 'box-shadow'), /inset 0 0 0 99px rgba\(70,36,0,0\)$/); assert.match(S.get('.btn.gold:not(:disabled):active', 'box-shadow'), /inset 0 0 0 99px rgba\(70,36,0,\.34\)$/);
    assert.match(S.get('.btn.pink', 'box-shadow'), /^inset 0 0 0 99px rgba\(10,0,24,0\)$/); assert.match(S.get('.btn.pink:not(:disabled):active', 'box-shadow'), /^inset 0 0 0 99px rgba\(10,0,24,\.45\)$/);
  });
  it('places to press are 44px or more; small text links get there with a clear pad around them', () => {
    for (const [sel, props] of [['.btn', ['min-height']], ['.btn.sm', ['min-height']], ['.chip', ['min-height', 'min-width']], ['.sw', ['width', 'height']], ['.linkbtn', ['min-height', 'min-width']], ['textarea', ['min-height']]]) {
      for (const p of props) assert.ok(px(S.get(sel, p)) >= 44, `${sel} ${p}: ${S.get(sel, p)}`);
    }
    // 광장 가기 and the paper's 신고 keep their look; ::after carries the size: (line + 2 × pad) tall, (min-width + 2 × pad) wide.
    const pad = (sel) => { assert.equal(S.get(sel, 'position'), 'absolute'); assert.equal(S.get(sel, 'content'), '""'); return String(S.get(sel, 'inset')).split(' ').map((x) => -px(x)); };
    const [bv] = pad('.brand::after'); assert.ok(px(S.get('.brand', 'line-height')) + 2 * bv >= 44, 'WISH BOARD'); assert.equal(S.get('.brand', 'position'), 'relative');
    const [rv, rh] = pad('.note .rp::after'); assert.ok(px(S.get('.note .rp', 'line-height')) + 2 * rv >= 44, '신고, tall'); assert.ok(px(S.get('.note .rp', 'min-width')) + 2 * rh >= 44, '신고, wide'); assert.equal(S.get('.note .rp', 'position'), 'relative');
    assert.ok(px(S.get('input[type=checkbox]', 'width')) >= 22, 'the consent box (its whole line is the label)');
    // Six colours in one row on a 360px phone: 360 - 2 × (16 page + 16 card + 1 line) = 294.
    assert.ok(6 * px(S.get('.sw', 'width')) + 5 * px(S.get('.chips.sws', 'gap')) <= 294);
  });
  it('no text under 12px', () => {
    for (const r of [...S.rules, ...S.media.flatMap((m) => m.rules)]) {
      const size = r.decl['font-size'] ? px(r.decl['font-size']) : /(\d+(?:\.\d+)?)px/.test(r.decl.font || '') ? Number(/(\d+(?:\.\d+)?)px/.exec(r.decl.font)[1]) : null;
      if (size != null) assert.ok(size >= 12, r.sels.join(', ') + ': ' + size + 'px');
    }
    assert.equal(S.get('.brand small', 'font-size'), '12px', '모두의 전광판 (a bare <small> is 10.8px)'); assert.equal(S.get('.tier .best', 'font-size'), '12px', '추천');
  });
  it('every text colour is 4.5:1 or more on the lightest surface it sits on', () => {
    const { page, card, ask, chip, chipOn, btn, field, tier, tierOn, lock, link, stat, tag, tagLive, pressed, gold, pink, best, notes } = SURF;
    // Each rule that sets a text colour, and what it can lie on. A new coloured text has to be added here with its surface.
    const ON = {
      body: [page, card, ask, tier, tierOn, stat], a: [page, card], '.brand': [page], '.brand small': [page], '.sub': [page, card, ask], '.fine': [page, card],
      '.label small, .field > label small': [card], 'input[type=text], input[type=date], textarea, select': [field], 'input::placeholder, textarea::placeholder': [field],
      // the main tower minute picker's open list (giftpage.js towerCard): its own opaque surface; a greyed minute must still be read
      'select option': [colours(S.get('select option', 'background'))[0]], 'select option:disabled': [colours(S.get('select option', 'background'))[0]],
      '.chip': [chip], '.chip[aria-pressed=true]': [chipOn], '.err': [card, ask], '.okmsg': [card, ask], '.btn': [btn], '.btn.gold': gold, '.btn.pink': pink, '.when': [card],
      '.stage .play': [lay(colours(S.get('.stage .play span', 'background'))[0], WHITE)], '.stage .rec': [WHITE, BLACK].map((u) => lay(colours(S.get('.stage .rec', 'background'))[0], u)),
      '.tag': [tag], '.tag.live': [tagLive], '.tier': [tier, tierOn], '.tier .price': [tier, tierOn], '.tier ul': [tier, tierOn], '.tier .best': best, '.tier .hint': [tier, tierOn],
      '.note': notes, '.note b': notes, '.note .rp': notes, '.lock': [lock], '.lock b': [lock], '.link': [link], '.stats span': [stat], '.boot': [page], '.foot': [page],
      '.linkbtn': [page, card, ask], '.linkbtn:active': [pressed, lay(rgb(S.vars['--press']), ask)], '.note .rp:active': notes.map((n) => lay(colours(S.get('.note .rp:active', 'background'))[0], n)),
    };
    const coloured = S.rules.filter((r) => 'color' in r.decl).map((r) => r.sels.join(', '));
    assert.deepEqual([...coloured].sort(), Object.keys(ON).sort(), 'the rules that colour text');
    assert.equal(S.media.some((m) => m.rules.some((r) => 'color' in r.decl)), false, 'no text colour changes with the screen');
    let low = { v: 99, at: '' };
    for (const [sel, under] of Object.entries(ON)) {
      const fg = rgb(S.val(S.rules.filter((r) => r.sels.join(', ') === sel).pop().decl.color));
      for (const u of under) { const v = ratio(fg, u); if (v < low.v) low = { v, at: sel }; assert.ok(v >= 4.5, `${sel}: ${v.toFixed(2)}:1`); }
    }
    assert.ok(low.v >= 4.5, `the lowest is ${low.v.toFixed(2)}:1 (${low.at})`);
    // What the audit measured: the small grey #77769c (2.4 to 3.5:1), the browser's own placeholder grey, white on the 추천 badge and on the pink button.
    assert.equal(/#77769c/i.test(S.css), false); assert.equal(S.vars['--dim'], '#a3a2c4');
    assert.ok(ratio(rgb('#77769c'), tierOn) < 3 && ratio(rgb('#77769c'), page) < 4.5, 'the old grey on these surfaces, by the same sum');
    assert.ok(ratio(WHITE, rgb(S.vars['--pink'])) < 4.5, 'white on the badge pink still fails: the badge text is dark');
  });
  it('the page loads the plaza\'s typeface without waiting for it, breaks Korean between words, and outlines the darkest colour', () => {
    const page = src('gift.html'), href = /<link rel="stylesheet" href="([^"]*pretendard[^"]*)"/.exec(src('index.html'))[1];
    assert.ok(page.includes(`<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'" />`), 'the same file as the plaza, never blocking the first paint');
    assert.equal(S.get('body', 'word-break'), 'keep-all'); assert.equal(S.get('body', 'overflow-wrap'), 'break-word', 'a long name without spaces still wraps; a short word beside it is not squeezed'); assert.equal(S.get('.link', 'word-break'), 'break-all', 'an address still breaks anywhere');
    assert.match(S.get('.sw', 'box-shadow'), /^0 0 0 1px rgba\(255,255,255,\.35\)$/, '밤하늘 is the card\'s own colour: a thin ring');
  });
  it('the owner\'s preview film is at most half the screen and 420px on a phone, the whole film beside the cards on a desk; the recipient\'s is as it was', () => {
    assert.match(S.css, /\.stage\.sm \{ max-width: min\(100%, calc\(min\(52vh, 420px\) \* 9 \/ 16\)\); max-width: min\(100%, calc\(min\(52dvh, 420px\) \* 9 \/ 16\)\);/);
    assert.equal(S.get('.stage', 'max-width'), 'min(100%, calc(72vh * 9 / 16))');
    const desk = S.media.find((m) => m.q === '(min-width: 900px)');
    assert.equal(desk.rules.find((r) => r.sels.includes('.stage.sm')).decl['max-width'], 'min(100%, calc(72vh * 9 / 16))');
    // A phone on its side: two columns, so the picture is not the whole first screen there either.
    const side = S.media.find((m) => /orientation: landscape/.test(m.q));
    assert.equal(side.q, '(orientation: landscape) and (max-height: 520px) and (min-width: 600px) and (max-width: 899px)');
    assert.equal(side.rules.find((r) => r.sels.includes('.cols')).decl.display, 'grid');
  });
});

describe('the gift pages on a phone: what the page script builds (giftpage.js)', () => {
  const g = view(), AT = KST('2026-11-25T19:00:00');
  const made = (o = {}) => (u, opt) => (u === '/rt/gift' && opt.method === 'POST' ? { ok: true, id: 'nnnnnnnn', gift: view({ id: 'nnnnnnnn', to: '수아', from: '' }), mine: { kids: 0, vd: 0, at: 1, lk: 1 }, media: false, ...o } : u.endsWith('/interest') ? { ok: true } : null);
  const maker = (o = {}) => fakeDom({ path: '/gift', at: AT, store: { masil_gt: GUEST() }, respond: made(), ...o });
  const own = (o = {}) => pageOf(o.gift || g, AT, { rec: !!o.media, store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([g.id]) },
    respond: (u) => (u === '/rt/gift/' + g.id ? { ok: true, gift: o.gift || g, own: true, mine: { kids: 0, vd: 0, at: 1, lk: 1 }, media: !!o.media } : u.endsWith('/interest') ? { ok: true } : null) });
  const flat = (P) => { const out = []; const walk = (n) => { out.push(n); for (const k of n.kids || []) walk(k); }; walk(P.app); return out; };
  const cardOf = (P, head) => P.all('section').find((c) => c.kids[0]?.tag === 'h2' && c.kids[0].textContent === head);
  // The first control under the page's top line, in reading order (the film's own play button is hidden while the film plays).
  const firstControl = (P) => P.controls().filter((n) => n.className !== 'brand')[0];

  it('nothing takes the cursor when the maker opens on a phone (no keyboard over the preview); with a mouse it waits in the name, the page still at its top', async () => {
    let P = maker({ touch: true });
    try {
      await P.load('giftpage.js');
      assert.deepEqual(P.heads('h1'), ['친구를 위해 뉴욕 타임스퀘어에 전광판을 걸어요']);
      assert.equal(P.timeouts.length, 0); await P.timers(); assert.equal(P.doc.activeElement, null);
      // A refused form still puts the cursor where the fault is: that is the person's own tap.
      await P.submit(); assert.equal(P.doc.activeElement, P.input('to'));
    } finally { P.done(); }
    P = pageOf(view({ from: '' }), KST('2026-11-26T09:00:00'), { touch: true }); // a reply to a board without a sender: the name is still to write, by hand
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/영상 건너뛰기/)); await P.press(P.btn(/고마워 전광판 걸기/));
      assert.deepEqual(P.heads('h1'), ['💌 답장 전광판을 걸어요']); assert.equal(P.timeouts.length, 0); assert.equal(P.doc.activeElement, null);
    } finally { P.done(); }
    P = maker();
    try {
      await P.load('giftpage.js'); assert.equal(P.timeouts.length, 1); assert.equal(P.timeouts[0].ms, 50);
      await P.timers(); assert.equal(P.doc.activeElement, P.input('to')); assert.deepEqual(P.input('to').focused, { preventScroll: true });
    } finally { P.done(); }
  });
  it('in the plaza\'s frame, Escape in the page asks the plaza to close it; not while Hangul is being composed, and not on a page of its own', async () => {
    let P = maker({ search: '?in=1', embed: true });
    try {
      await P.load('giftpage.js');
      await P.key(P.docOn, 'a'); await P.key(P.docOn, 'Escape', { isComposing: true }); await P.key(P.docOn, 'Process', { keyCode: 229 }); await P.key(P.docOn, 'Escape', { keyCode: 229 });
      assert.deepEqual(P.posted, [], 'typing, and Escape that only drops a half-typed syllable');
      await P.key(P.docOn, 'Escape');
      assert.deepEqual(P.posted, [{ t: 'gift', act: 'close', id: '' }]);
    } finally { P.done(); }
    P = maker();
    try { await P.load('giftpage.js'); assert.equal((P.docOn.keydown || []).length, 0); assert.ok((P.docOn.touchstart || []).length >= 1, 'iOS shows :active only on a page that listens for touches'); } finally { P.done(); }
  });
  it('a refused field is read out and marked, until it is typed in again (the maker and the 롤링페이퍼)', async () => {
    let P = maker();
    try {
      await P.load('giftpage.js'); await P.submit();
      const to = P.input('to'), line = P.input('err-to');
      assert.equal(line.textContent, '받는 사람 이름을 적어 주세요.'); assert.equal(line.attrs.role, 'alert');
      assert.equal(to.attrs['aria-invalid'], 'true'); assert.equal(to.attrs['aria-describedby'], 'err-to');
      for (const id of ['msg', 'from']) { assert.equal(P.input(id).attrs['aria-describedby'], 'err-' + id); assert.equal(P.input('err-' + id).attrs.role, 'alert'); assert.equal(P.input(id).attrs['aria-invalid'], 'false'); }
      to.value = '수아'; for (const f of to.on.input) f();
      assert.equal(to.attrs['aria-invalid'], 'false'); assert.equal(line.textContent, '');
      P.input('msg').value = 'https://evil.example/x'; for (const f of P.input('msg').on.input) f();
      await P.submit();
      assert.equal(P.input('msg').attrs['aria-invalid'], 'true'); assert.equal(to.attrs['aria-invalid'], 'false'); assert.equal(P.doc.activeElement, P.input('msg'));
      assert.equal(P.sent.some((s) => s.method === 'POST'), false);
    } finally { P.done(); }
    P = pageOf(view({ phase: 'before' }), KST('2026-11-24T12:00:00'));
    try {
      await P.load('giftpage.js'); await P.submit();
      const txt = P.all('textarea')[0], line = P.input('paper-msg');
      assert.equal(line.attrs.role, 'alert'); assert.ok(line.textContent.length > 0); assert.equal(txt.attrs['aria-invalid'], 'true'); assert.equal(txt.attrs['aria-describedby'], 'paper-msg');
      for (const f of txt.on.input) f(); assert.equal(txt.attrs['aria-invalid'], 'false');
    } finally { P.done(); }
  });
  it('the maker: two short lines under the button; the other rules are kept, at the foot of the page', async () => {
    const P = maker();
    try {
      await P.load('giftpage.js');
      const form = P.all('form')[0], send = P.btn(/무료로 걸기/);
      assert.deepEqual(form.kids.filter((n) => n.className === 'fine').map((n) => n.textContent), ['결제는 없어요. 문구는 광장에서 누구나 볼 수 있어요.']);
      assert.ok(form.kids.indexOf(send) < form.kids.findIndex((n) => n.className === 'fine'));
      const foot = P.all('footer')[0].textContent;
      for (const re of [/글자만 걸고 사진은 받지 않아요\./, /받는 사람의 연락처는 적지 않아요\./, /신고가 쌓이면 문구가 가려지고/, /기념 페이지는 그날이 지나고 7일 뒤에 지워져요\./, /뉴욕 타임스퀘어를 본뜬 가상 광장이에요\. 실제 타임스퀘어와는 관계가 없어요\./, /약관과 개인정보처리방침은 광장의 설정 › 정보에 있어요\./]) assert.match(foot, re);
      const home = P.btn(/^광장 가기$/); assert.equal(home.tag, 'a'); assert.equal(home.className, 'linkbtn', 'a 44px place to press, not a word in a sentence');
      assert.equal(P.all('div').find((n) => n.attrs['aria-label'] === '색').className, 'chips sws');
    } finally { P.done(); }
  });
  it('the owner page: the title, a small preview, then 공유하기 and 링크 복사 with nothing to read first (also right after hanging a board)', async () => {
    const check = (P, title) => {
      assert.deepEqual(P.heads('h1'), [title]);
      const all = flat(P), at = (n) => all.indexOf(n), stage = P.all('div').find((n) => /^stage/.test(n.className)), share = cardOf(P, '🔗 링크 보내기');
      assert.equal(stage.className, 'stage sm', 'the preview is the small one');
      assert.equal(stage.parent.kids.at(-1), stage, 'nothing between the preview and the first card');
      assert.deepEqual(share.kids[1].kids.map((n) => [n.tag, n.textContent, n.className]), [['button', '공유하기', 'btn gold'], ['button', '링크 복사', 'btn']], 'the buttons come right under the card\'s title');
      assert.ok(at(P.all('h1')[0]) < at(stage) && at(stage) < at(share) && at(share) < at(P.btn(/^공유하기$/)));
      assert.equal(firstControl(P).textContent, '공유하기', 'the first thing to press on the page');
      const words = share.kids.filter((n) => n.tag === 'p' && n.className === 'fine').map((n) => n.textContent);
      assert.deepEqual(words, ['친구들에게 먼저 보내 메시지를 모으고, 그날 ' + (title === '🎉 걸었어요!' ? '수아' : '민지') + '님에게 보내세요. 메시지는 그날(11월 25일 (수)) 0시에 함께 열려요.'], 'how to use the link: kept, small, under the buttons');
      assert.ok(share.kids.indexOf(share.kids.find((n) => n.className === 'link')) > 1, 'the address under the buttons');
      assert.deepEqual(P.heads(), ['🔗 링크 보내기', '✨ 더 크게, 더 오래 걸고 싶다면', '🎬 15초 축하 영상', '🎬 실사 축하 영상', '📊 지금까지']);
      assert.equal(P.says(/^미리보기 영상은 무료 버전이라 워터마크가 있어요\.$/), true); assert.equal(P.says(/^아래는 준비 중인 상품이에요\. 지금은 결제가 없고, 고르면 "열리면 알림"을 받을 수 있어요\.$/), true, 'no payment: still said');
    };
    let P = own();
    try { await P.load('giftpage.js'); check(P, '🎂 민지님을 위한 선물 전광판'); } finally { P.done(); }
    P = maker({ touch: true });
    try {
      await P.load('giftpage.js'); P.input('to').value = '수아'; for (const f of P.input('to').on.input) f();
      await P.submit(); check(P, '🎉 걸었어요!');
    } finally { P.done(); }
    // The recipient's page keeps the whole film: it is what that page is for.
    P = pageOf(g, AT);
    try { await P.load('giftpage.js'); assert.equal(P.all('div').find((n) => /^stage/.test(n.className)).className, 'stage'); } finally { P.done(); }
  });
  it('video first (the Worker stores videos): the video card still leads and starts with its gold button; after the window it starts with why there is none', async () => {
    let P = own({ media: true });
    try {
      await P.load('giftpage.js');
      assert.deepEqual(P.heads(), ['🎬 15초 축하 영상', '🔗 링크 보내기', '🎬 실사 축하 영상', '✨ 더 크게, 더 오래 걸고 싶다면', '📊 지금까지']);
      const vid = cardOf(P, '🎬 15초 축하 영상');
      assert.deepEqual([vid.kids[1].tag, vid.kids[1].className, vid.kids[1].textContent], ['a', 'btn gold', '🎬 광장에서 진짜 15초 영상 만들기 · 약 25초']);
      assert.equal(firstControl(P), vid.kids[1], 'the first thing to press on the page');
      assert.deepEqual(vid.kids.filter((n) => n.className === 'fine').map((n) => n.textContent), ['광장에서 이 전광판 앞의 폭죽과 환호를 세로 영상으로 찍어요. 이 기기에서 만들고, 1~2분 걸릴 수 있어요.', '찍은 영상은 받는 사람 페이지에 올라가요. 그날이 지나고 7일 뒤에 지워져요.', '미리보기 영상은 무료 버전이라 워터마크가 있어요.']);
      assert.equal(P.all('div').find((n) => /^stage/.test(n.className)).className, 'stage sm');
      assert.deepEqual(cardOf(P, '🔗 링크 보내기').kids[1].kids.map((n) => n.className), ['btn', 'btn'], 'one gold button on the page');
    } finally { P.done(); }
    P = own({ media: true, gift: view({ phase: 'after' }) });
    try {
      await P.load('giftpage.js');
      const vid = cardOf(P, '🎬 15초 축하 영상');
      assert.deepEqual(vid.kids.filter((n) => n.className === 'fine').map((n) => n.textContent).slice(0, 2), ['광장에서 내려온 전광판은 새 영상을 찍을 수 없어요.', '찍은 영상은 받는 사람 페이지에 올라가요. 그날이 지나고 7일 뒤에 지워져요.']);
    } finally { P.done(); }
  });
  it('every button and link the pages build carries a class that has a pressed state in the sheet', async () => {
    const RULE = { btn: '.btn:not(:disabled):active', chip: '.chip:not(:disabled):active', sw: '.sw:active', tier: '.tier:active', linkbtn: '.linkbtn:active', brand: '.brand:active', rp: '.note .rp:active', play: '.stage .play:active span' };
    for (const sel of Object.values(RULE)) assert.ok(SHEET.rules.some((r) => r.sels.includes(sel)), sel);
    const seen = new Set();
    const sweep = (P, where) => { for (const n of [...P.all('button'), ...P.all('a')]) { const c = n.className.split(/\s+/).find((x) => RULE[x]); assert.ok(c, `${where}: "${n.textContent}" (${n.className || 'no class'}) has no pressed state`); seen.add(c); } };
    let P = maker();
    try { await P.load('giftpage.js'); sweep(P, 'the maker'); } finally { P.done(); }
    P = own({ media: true });
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/^공유하기$/)); await P.press(P.all('button').find((n) => n.className === 'tier' && /축하 영상 세트/.test(n.textContent)));
      assert.ok(P.btn(/그냥 보내기/) && P.btn(/열리면 알림 받기/) && P.btn(/무료로 둘게요/), 'the nudge and the notice box are up');
      sweep(P, 'the owner page');
    } finally { P.done(); }
    P = pageOf(view({ paper: [{ id: 'p00001', nick: '친구', txt: '축하해' }] }), AT);
    try { await P.load('giftpage.js'); await P.press(P.btn(/영상 건너뛰기/)); assert.ok(P.btn(/^신고$/)); sweep(P, 'the recipient page'); } finally { P.done(); }
    P = pageOf(view({ phase: 'before' }), KST('2026-11-24T12:00:00'));
    try { await P.load('giftpage.js'); assert.ok(P.btn(/점등식 같이 보기/), 'the ceremony button before the day'); sweep(P, 'the page before the day'); } finally { P.done(); }
    // 점등식 inside its window: the link into the plaza, and the button that says the plaza is busy (budget hard).
    for (const hard of [false, true]) {
      P = fakeDom({ path: '/g/abcd1234', data: { id: 'abcd1234', gift: view(), now: KST('2026-11-25T17:55:00'), media: false, ...(hard ? { hard } : {}) }, at: KST('2026-11-25T17:55:00'), store: { masil_gt: GUEST() } });
      try { await P.load('giftpage.js'); assert.equal(P.btn(/점등식 들어가기/).tag, hard ? 'button' : 'a'); sweep(P, 'the page in the ceremony window' + (hard ? ' at budget hard' : '')); } finally { P.done(); }
    }
    P = fakeDom({ path: '/g/abcd1234', data: { id: 'abcd1234', gift: null, now: AT, media: false }, at: AT });
    try { await P.load('giftpage.js'); assert.deepEqual(P.heads('h1'), ['기념 페이지가 끝났거나 가려졌어요']); sweep(P, 'the page that is gone'); } finally { P.done(); }
    assert.deepEqual([...seen].sort(), Object.keys(RULE).sort(), 'and every kind of control was met');
  });
});

describe('the gift page over the plaza is a dialog like the sheets (gift.js)', () => {
  // The plaza with its HUD's 🌠 button; the world only records whether its input is on.
  async function plaza(o = {}) {
    const P = fakeDom({ path: '/', at: KST('2026-11-25T19:00:00'), store: { masil_gt: GUEST() }, respond: () => null, ...o });
    P.locks = [];
    const { mountGift } = await P.load('gift.js');
    P.gift = mountGift({ world: { setGifts() {}, setInputEnabled: (on) => P.locks.push(on) }, ui: { note() {} }, whenBuilt: (f) => f(), introDone() {} });
    P.frame = () => P.doc.body.kids.find((n) => n.id === 'kts-gift-frame') || null;
    P.giftBtn = P.tools.kids[1];
    P.say = (data) => { for (const f of P.winOn.message) f({ origin: P.loc.origin, data }); };
    return P;
  }
  // gift.js's own sheet (a template string) as rules.
  const GCSS = (() => {
    const text = /const CSS = `([\s\S]*?)`;/.exec(src('gift.js'))[1].replace(/\$\{GIFT_SANS\}/g, 'sans-serif');
    const rules = Object.fromEntries([...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), Object.fromEntries(m[2].split(';').filter(Boolean).map((d) => { const k = d.indexOf(':'); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; }))]));
    return rules;
  })();

  it('it is a named modal dialog; opening it moves focus to the frame itself, never into a field', async () => {
    const P = await plaza();
    try {
      assert.equal(P.giftBtn.attrs['aria-label'], '선물 전광판 걸기'); assert.equal(P.frame(), null);
      await P.press(P.giftBtn);
      const f = P.frame(), ifr = f.kids.find((n) => n.tag === 'iframe'), x = f.kids.find((n) => n.tag === 'button');
      assert.deepEqual([f.attrs.role, f.attrs['aria-modal'], f.attrs['aria-label'], f.attrs.tabindex], ['dialog', 'true', '선물 전광판 만들기', '-1']);
      assert.equal(ifr.src, '/gift?in=1'); assert.equal(ifr.title, '선물 전광판 만들기');
      assert.equal(P.doc.activeElement, f); assert.deepEqual(f.focused, { preventScroll: true });
      assert.deepEqual(P.locks, [false], 'the plaza under it takes no input');
      // The close button: named, and drawn with the sheets' two-stroke icon (no ✕ letter).
      assert.equal(x.attrs['aria-label'], '닫기'); assert.equal(x.type, 'button'); assert.equal(x.textContent, '');
      assert.deepEqual(x.kids.map((n) => [n.tag, n.attrs.viewBox, n.attrs['aria-hidden']]), [['svg', '0 0 24 24', 'true']]);
      assert.equal(x.kids[0].kids[0].attrs.d, 'M6 6L18 18M18 6L6 18');
      assert.ok(/close: \['M6 6L18 18', 'M18 6L6 18'\]/.test(src('uiicons.js')), 'the same strokes as the sheets\' close icon (uiicons.js)');
      // A board's page opened from a reply notice is named for what it is.
      P.swOn.message({ data: { t: 'push', url: '/g/abcd1234?o=1' } });
      assert.equal(P.frame().attrs['aria-label'], '선물 전광판'); assert.equal(P.frame().attrs.role, 'dialog'); assert.equal(P.frame().kids.find((n) => n.tag === 'iframe').title, '선물 전광판');
    } finally { P.done(); }
  });
  it('Escape in the plaza closes it and nothing under it, and focus goes back to the 🎁 button; without the frame Escape is the plaza\'s', async () => {
    const P = await plaza();
    try {
      let e = await P.key(P.winOn, 'Escape');
      assert.deepEqual([e.defaultPrevented, e.stopped], [false, false], 'nothing open: the plaza\'s own listeners get the key');
      await P.press(P.giftBtn);
      for (e of [await P.key(P.winOn, 'a'), await P.key(P.winOn, 'Enter'), await P.key(P.winOn, 'Escape', { isComposing: true })]) assert.deepEqual([!!P.frame(), e.stopped], [true, false]);
      e = await P.key(P.winOn, 'Escape');
      assert.equal(P.frame(), null);
      assert.deepEqual([e.defaultPrevented, e.stopped], [true, true], 'one press closes this, not also a sheet under it');
      assert.equal(P.doc.activeElement, P.giftBtn); assert.deepEqual(P.giftBtn.focused, { preventScroll: true });
      assert.deepEqual(P.locks, [false, true], 'the plaza takes input again');
      e = await P.key(P.winOn, 'Escape'); assert.equal(e.stopped, false);
      await P.press(P.giftBtn); assert.ok(P.frame(), 'and it opens again');
    } finally { P.done(); }
  });
  it('the close button and the page\'s own close message do the same; focus returns to what opened it, or to 🎁 when that is gone', async () => {
    const P = await plaza();
    try {
      // Opened from another control of the plaza (the "친구 이름을 전광판에 걸어 보세요" card calls gift.open()).
      const task = P.doc.createElement('button'); P.doc.body.append(task); task.focus();
      P.gift.open();
      await P.press(P.frame().kids.find((n) => n.tag === 'button'));
      assert.equal(P.frame(), null); assert.equal(P.doc.activeElement, task);
      P.gift.open(); assert.equal(P.doc.activeElement, P.frame());
      task.remove();
      P.say({ t: 'gift', act: 'close' }); // 광장 가기 or Escape inside the page (giftpage.js)
      assert.equal(P.frame(), null); assert.equal(P.doc.activeElement, P.giftBtn);
      // Messages that are not the page's do nothing.
      P.gift.open(); for (const f of P.winOn.message) f({ origin: 'https://evil.example', data: { t: 'gift', act: 'close' } }); P.say({ t: 'other', act: 'close' });
      assert.ok(P.frame());
    } finally { P.done(); }
  });
  it('its close button is the sheets\' close button, value for value (index.html .x)', () => {
    const page = src('index.html'), decl = (re, what) => { const m = re.exec(page); assert.ok(m, 'index.html: ' + what + ' is not where it was. Read the sheet close button again and match gift.js to it'); return Object.fromEntries(m[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const k = d.indexOf(':'); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; })); };
    const sheet = decl(/\n\s*\.x \{([^}]*)\}/, '.x'), hover = decl(/\n\s*\.x:hover \{([^}]*)\}/, '.x:hover'), pad = decl(/\n\s*html\.touch \.x::after \{([^}]*)\}/, 'html.touch .x::after'), ico = decl(/\n\s*\.x svg\.ico, \.mapzoom button svg\.ico \{([^}]*)\}/, '.x svg.ico'), line = decl(/\n\s*svg\.ico \{([^}]*)\}/, 'svg.ico');
    const root = (k) => { const m = new RegExp('\\n\\s*' + k + ': (#[0-9a-f]{6});').exec(page); assert.ok(m, 'index.html :root ' + k); return m[1]; };
    const mine = GCSS['#kts-gift-frame button'], mineHover = GCSS['#kts-gift-frame button:hover'], minePad = GCSS['#kts-gift-frame button::after'], mineIco = GCSS['#kts-gift-frame button svg'];
    // Same size and corners (it was a 40px circle), same layout.
    for (const p of ['width', 'height', 'border-radius', 'display', 'place-items']) assert.equal(mine[p], sheet[p], p);
    assert.deepEqual([mine.width, mine.height, mine['border-radius']], ['38px', '38px', '10px']);
    // Same colours: the plaza's own tokens, with their values of today behind them.
    const same = (got, want) => { assert.equal(got.replace(/var\((--[\w-]+),#[0-9a-f]{6}\)/g, 'var($1)'), want); for (const m of got.matchAll(/var\((--[\w-]+),(#[0-9a-f]{6})\)/g)) assert.equal(m[2], root(m[1]), m[1]); };
    same(mine.color, sheet.color); same(mine.background, sheet.background); same(mine.border, sheet.border);
    same(mineHover.color, hover.color); same(mineHover['border-color'], hover['border-color']);
    // Same place to press (38 + 3 + 3 = 44) and the same icon: 20px, the same stroke.
    assert.equal(minePad.inset, pad.inset); assert.equal(minePad.position, 'absolute'); assert.equal(minePad.content, '""');
    assert.equal(px(mine.width) - 2 * px(minePad.inset), 44);
    for (const p of ['width', 'height']) assert.equal(mineIco[p], ico[p], 'icon ' + p);
    for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']) assert.equal(mineIco[p], line[p], 'icon ' + p);
  });
  it('the page inside leaves the close button its corner (its top line ends short of it)', () => {
    const x = GCSS['#kts-gift-frame button'], inset = Number(/^max\((\d+)px,/.exec(x.right)[1]), edge = Number(/max\((\d+)px, env\(safe-area-inset-right\)\)/.exec(SHEET.get('main', 'padding'))[1]);
    assert.deepEqual([inset, edge], [10, 16]);
    assert.ok(edge + px(SHEET.get('html.embed .top', 'padding-right')) >= inset + px(x.width) + 8, 'the brand line and the button do not meet');
  });
  it('the plaza-side gift controls have a pressed state too: the close button, the buttons under the finished video, 취소 while it records', () => {
    const x = GCSS['#kts-gift-frame button'], down = GCSS['#kts-gift-frame button:active'];
    assert.ok(down.background && down.color && down.transition === 'none');
    const rest = rgb(/#[0-9a-f]{6}/.exec(x.background)[0]), hit = rgb(down.background);
    assert.ok(ratio(rest, hit) >= 1.4, 'the fill moves ' + ratio(rest, hit).toFixed(2) + ':1');
    assert.ok(ratio(rgb(/#[0-9a-f]{6}/.exec(x.color)[0]), rest) >= 4.5 && ratio(rgb(/#[0-9a-f]{6}/.exec(down.color)[0]), hit) >= 4.5, 'the icon stays clear');
    assert.ok(GCSS['#kts-gift-done .b:active']['background-color'] && GCSS['#kts-gift-done .b:active'].transition === 'none');
    assert.match(GCSS['#kts-gift-done .b.gold:active']['box-shadow'], /^inset 0 0 0 99px rgba\(70,36,0,\.34\)$/, 'the gold one: the same wash as gift.html');
    assert.match(GCSS['#kts-gift-done .b']['box-shadow'], /^inset 0 0 0 99px rgba\(70,36,0,0\)$/);
    assert.ok(px(GCSS['#kts-gift-done .b']['min-height']) >= 44);
    assert.ok(GCSS['#kts-gift-rec button:active'].background); assert.equal(GCSS['#kts-gift-rec button::after'].position, 'absolute'); assert.equal(GCSS['#kts-gift-rec button'].position, 'relative');
    // 취소: a 20px line, 4px above and below, and 8px more to press each way (44); 44px wide.
    const rec = GCSS['#kts-gift-rec button'], recPad = String(GCSS['#kts-gift-rec button::after'].inset).split(' ').map((v) => -px(v) || 0), vpad = px(rec.padding.split(' ')[0]);
    assert.ok(px(rec['line-height']) + 2 * vpad + 2 * recPad[0] >= 44); assert.ok(px(rec['min-width']) >= 44);
  });
});

// ---- the loop's gaps (2026-11-27): the visitor's 공유하기, 💖, the maker's start beacon, the admin numbers ------------------------------
describe('the recipient page passes itself on and takes a heart; the maker counts its start', () => {
  const g = view({ hearts: 12 }), AT = KST('2026-11-25T19:00:00'), URL_ = 'https://sq.example/g/' + g.id;
  // sendBeacon as the page calls it: [url, the JSON body] (the fake one only says it went).
  const beacons = (P) => { const out = []; globalThis.navigator.sendBeacon = (u, b) => { out.push(b.text().then((t) => [String(u), JSON.parse(t)])); return true; }; return async () => Promise.all(out); };
  const open = async (P) => { await P.load('giftpage.js'); await P.press(P.btn(/영상 건너뛰기/)); };
  const heartOf = (P) => P.btn(/하트 \d+$/);

  it('a visitor gets 🔗 공유하기 beside the heart, under the reply (the reply stays first); it sends the /g/<id> address and counts as reshare', async () => {
    let P = pageOf(g, AT);
    try {
      P.shared.length = 0; globalThis.navigator.share = async (o) => { P.shared.push(o); };
      await open(P);
      const share = P.btn(/^🔗 공유하기$/), acts = share.parent.parent;
      assert.equal(acts.className, 'stack');
      assert.equal(acts.kids[0].textContent, '💌 지수님에게 답장 전광판 걸기', 'the reply is still the first button');
      assert.equal(acts.kids[1], share.parent, 'the share and heart row right under it');
      assert.deepEqual(share.parent.kids.map((n) => n.textContent), ['🔗 공유하기', '🤍 하트 12']);
      assert.equal(share.parent.className, 'row');
      await P.press(share);
      assert.deepEqual(P.shared, [{ title: '민지님을 위한 선물 전광판', text: '🎂 민지님을 위한 선물 전광판이 뉴욕 타임스퀘어 가상 광장에 걸려 있어요! 같이 축하 메시지 남겨 주세요 👉', url: URL_ }]);
      assert.equal(P.seen(g.id, 'reshare'), true); assert.equal(P.seen(g.id, 'share'), false, 'not the owner\'s count');
      for (const w of [/게임|코인|점령|레벨|명성/]) assert.equal(w.test(P.shared[0].text), false);
    } finally { P.done(); }
    // No share sheet: the clipboard (the words, then the address); no clipboard either: the address shown to copy by hand.
    P = pageOf(view({ takes: false }), KST('2026-11-26T09:00:00'));
    try {
      await open(P); await P.press(P.btn(/^🔗 공유하기$/));
      assert.deepEqual(P.copied, ['🎂 민지님을 위한 선물 전광판이 뉴욕 타임스퀘어 가상 광장에 걸렸어요! 같이 봐 주세요 👉 ' + URL_]);
      assert.equal(P.says(/링크를 복사했어요/), true); assert.equal(P.seen(g.id, 'reshare'), true);
    } finally { P.done(); }
    P = pageOf(g, AT);
    try {
      await open(P);
      const box = P.all('input').find((n) => n.className === 'link');
      assert.equal(P.shown(box), false, 'the copy box waits');
      assert.deepEqual([box.attrs.type, 'readonly' in box.attrs, box.value, box.attrs['aria-label']], ['text', true, URL_, '이 전광판 주소'], 'a read-only field with the address');
      let picked = 0; box.select = () => { picked++; };
      globalThis.navigator.clipboard.writeText = async () => { throw new Error('no'); };
      await P.press(P.btn(/^🔗 공유하기$/));
      assert.equal(P.shown(box), true); assert.equal(P.doc.activeElement, box, 'focused'); assert.equal(picked, 1, 'and selected');
      assert.equal(P.says(/아래 주소를 길게 눌러 복사해 주세요/), true);
      assert.equal(P.seen(g.id, 'reshare'), false, 'nothing was handed over');
    } finally { P.done(); }
    // A second tap while the share sheet is still open: nothing (no second sheet, no clipboard, one count).
    P = pageOf(g, AT);
    try {
      let close; const opened = [];
      globalThis.navigator.share = (o) => { opened.push(o); if (opened.length > 1) return Promise.reject(Object.assign(new Error('busy'), { name: 'InvalidStateError' })); return new Promise((ok) => { close = ok; }); };
      await open(P);
      const btn = P.btn(/^🔗 공유하기$/);
      for (const f of btn.on.click) f({ preventDefault() {}, target: btn }); await P.settle();
      await P.press(btn);
      assert.equal(opened.length, 1, 'one sheet'); assert.deepEqual(P.copied, [], 'no copy behind it'); assert.equal(P.says(/링크를 복사했어요/), false);
      close(); await P.settle();
      assert.equal(P.seen(g.id, 'reshare'), true);
      delete P.store.kts_gseen; await P.press(btn); assert.equal(opened.length, 2, 'a tap after it closed opens it again');
    } finally { P.done(); }
  });

  it('nothing to pass on before the board is revealed, and a heart without its count (메인 타워 축하 1분 counts it); the owner\'s preview shows the heart as it stands and no share', async () => {
    let P = pageOf(view({ phase: 'before' }), KST('2026-11-24T12:00:00'));
    try { await P.load('giftpage.js'); assert.equal(P.btn(/공유하기/), null); assert.equal(heartOf(P), null, 'no count'); assert.ok(P.btn(/^🤍 하트 보내기$/), 'the heart itself'); } finally { P.done(); }
    P = pageOf(g, AT, { store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([g.id]) }, respond: (u) => (u === '/rt/gift/' + g.id ? { ok: true, gift: g, own: true, mine: { kids: 0, vd: 0, at: 1, lk: 1 }, media: false } : u.endsWith('/interest') ? { ok: true } : null) });
    try {
      await P.load('giftpage.js');
      const stats = P.all('div').find((n) => n.className === 'stats');
      assert.deepEqual(stats.kids.map((n) => n.textContent), ['0열어 본 사람', '0친구 메시지', '12💖 하트', '0이어서 걸린 전광판'], 'the owner sees the count');
      await P.press(P.btn(/받는 사람에게 보이는 화면/));
      assert.equal(P.btn(/🔗 공유하기/), null);
      assert.equal(heartOf(P).disabled, true); assert.equal(heartOf(P).textContent, '🤍 하트 12');
      await P.press(heartOf(P)); assert.equal(P.sent.some((s) => s.url.endsWith('/heart')), false, 'the owner looking does not heart');
    } finally { P.done(); }
  });

  it('💖: one press per device, sent with the device id, kept pressed on this device; a refusal goes back quietly', async () => {
    const store = { masil_gt: GUEST() };
    let P = pageOf(g, AT, { store, respond: (u) => (u.endsWith('/heart') ? { ok: true } : null) });
    try {
      await open(P);
      const btn = heartOf(P);
      assert.deepEqual([btn.textContent, btn.attrs['aria-pressed'], btn.attrs['aria-label'], btn.className], ['🤍 하트 12', 'false', '하트 보내기, 12개', 'btn']);
      await P.press(btn); await P.press(btn);
      const sent = P.sent.filter((s) => s.url === '/rt/gift/' + g.id + '/heart');
      assert.equal(sent.length, 1, 'one press'); assert.equal(sent[0].method, 'POST'); assert.match(sent[0].body.v, /^[0-9a-f]{16}$/); assert.equal(sent[0].body.v, store.kts_gv, 'the device id a view uses');
      assert.equal(sent[0].auth, '', 'no token, no account');
      assert.deepEqual([btn.textContent, btn.attrs['aria-pressed']], ['💖 하트 13', 'true']);
    } finally { P.done(); }
    P = pageOf(g, AT, { store });
    try { await open(P); assert.deepEqual([heartOf(P).textContent, heartOf(P).attrs['aria-pressed']], ['💖 하트 13', 'true'], 'opened again: still pressed, still counted while the copies catch up'); } finally { P.done(); }
    P = pageOf(view({ hearts: 20 }), AT, { store });
    try { await open(P); assert.equal(heartOf(P).textContent, '💖 하트 20', 'the board\'s own count once it is past this device\'s'); } finally { P.done(); }
    P = pageOf(view({ id: 'zzzz1234', hearts: 3 }), AT, { respond: () => null }); // busy (503) or the minute (429): the Worker says no
    try {
      await open(P); await P.press(heartOf(P));
      assert.deepEqual([heartOf(P).textContent, heartOf(P).attrs['aria-pressed']], ['🤍 하트 3', 'false']);
      assert.equal(P.says(/^잠시 뒤에 다시 눌러 주세요\.$/), true); assert.equal(P.says(/오류|실패|error/i), false);
      assert.equal(JSON.parse(P.store.kts_ghearts || '{}').zzzz1234, undefined);
    } finally { P.done(); }
  });

  it('the maker sends one start beacon per page load: 0 for a fresh form, 1 from another board; not again when the form is built again', async () => {
    let P = fakeDom({ path: '/gift', at: AT, store: { masil_gt: GUEST() } }), got = beacons(P);
    try { await P.load('giftpage.js'); assert.deepEqual(await got(), [['/rt/gift/start', { r: 0 }]]); } finally { P.done(); }
    P = fakeDom({ path: '/gift', search: '?ref=abcd1234', at: AT, store: { masil_gt: GUEST() } }); got = beacons(P);
    try { await P.load('giftpage.js'); assert.deepEqual(await got(), [['/rt/gift/start', { r: 1 }]]); } finally { P.done(); }
    P = pageOf(g, AT); got = beacons(P);
    try {
      await open(P);
      assert.deepEqual((await got()).filter(([u]) => u === '/rt/gift/start'), [], 'the board page is not the maker');
      await P.press(P.btn(/답장 전광판 걸기/)); // the reply's maker
      await P.step(-1); await P.step(1); // back to the board and forward to the maker: built again
      assert.deepEqual(P.heads('h1'), ['💌 답장 전광판을 걸어요']);
      assert.deepEqual((await got()).filter(([u]) => u === '/rt/gift/start'), [['/rt/gift/start', { r: 1 }]], 'once, as one from another board');
    } finally { P.done(); }
  });

  it('admin: the new counters and the two ratios in the table, and the makers line', async () => {
    const days = [{ d: '2026-11-25', start: 10, made: 4, made_ref: 1, hit: 20, hitbot: 7, view: 15, heart: 3, 'ev:reshare': 2, 'ev:share': 5, start_ref: 2, made_again: 1 }, { d: '2026-11-24', start: 0, made: 0, hit: 0 }, { d: '2026-11-23', made: 6, made_ref: 0, view: 30 }]; // the 23rd: before start and hit existed
    const P = fakeDom({ path: '/admin.html', at: AT, respond: (u) => (u.startsWith('/rt/admin/gift/stats') ? { ok: true, days, arms: [], optins: [], makers: { week: { from: '2026-11-23', n: 3 }, d30: { one: 2, more: 1 }, keptFrom: 1 } } : u.startsWith('/rt/admin/gift?') ? { ok: true, boards: [], media: false, e3: false } : null) });
    const nodes = () => { const out = []; const walk = (n) => { if (n.nodeType === 1) { out.push(n); for (const k of n.kids) walk(k); } }; walk(P.app); return out; };
    P.doc.getElementById = (id) => nodes().find((n) => n.attrs.id === id) || null; P.doc.querySelector = () => P.app;
    globalThis.sessionStorage = { getItem: () => 'admin-key' };
    try {
      await P.load('admin-gift.js');
      const rows = P.all('tr').map((r) => r.kids.map((c) => c.textContent)), head = rows[0], col = (name) => head.indexOf(name);
      for (const n of ['만들기 시작', '다른 보드에서 와서 시작', '두 번째부터', '링크 열림(사람)', '링크 열림(미리보기·봇)', '공유(주인)', '공유(받는 사람)', '💖 하트', 'K', '시작→만듦', '링크(사람)→방문']) assert.ok(col(n) > 0, n);
      const day = rows.find((r) => r[0] === '2026-11-25'), sum = rows.at(-1);
      assert.deepEqual([day[col('만들기 시작')], day[col('공유(받는 사람)')], day[col('공유(주인)')], day[col('💖 하트')], day[col('링크 열림(미리보기·봇)')]], ['10', '2', '5', '3', '7']);
      assert.deepEqual([day[col('시작→만듦')], day[col('링크(사람)→방문')], day[col('K')]], ['0.40', '0.75', '0.25']);
      assert.deepEqual(rows.find((r) => r[0] === '2026-11-24').slice(-2), ['—', '—'], 'nothing to divide by');
      assert.deepEqual([sum[0], sum[col('시작→만듦')], sum[col('링크(사람)→방문')], sum[col('K')]], ['30일', '0.40', '0.75', '0.10'], 'a ratio sums only the days that have its denominator');
      const old = rows.find((r) => r[0] === '2026-11-23');
      assert.deepEqual([old[col('만들기 시작')], old[col('링크 열림(사람)')], old[col('만든 보드')], old[col('시작→만듦')], old[col('링크(사람)→방문')]], ['—', '—', '6', '—', '—'], 'a key the day does not have');
      assert.deepEqual([sum[col('만든 보드')], sum[col('만들기 시작')], sum[col('신고')]], ['10', '10', '—']);
      assert.equal(P.says(/^이번 주\(2026-11-23 월요일부터\) 3명 · 30일 안: 1개 2명, 2개 이상 1명/), true);
    } finally { P.done(); delete globalThis.sessionStorage; }
    assert.match(src('admin-gift.js'), /\['ev:go', '직접 가서 봄'\], \['ev:cer', '점등식 온 기기'\], \['ev:cershot', '단체 사진 저장·공유'\], /);
  });
});

describe('메인 타워 축하 1분 on the gift pages', () => {
  const ID = 'abcd1234', AT = KST('2026-11-25T12:00:00'), M = KST('2026-11-25T20:30:00'), DAYS = { [DAY]: { left: 30, mine: false } };
  // o.at: the page's clock (the page data's now must match it: giftpage.js takes its skew from there); o.book: the POST's answer.
  const ownerPage = (tower, o = {}) => fakeDom({ path: '/g/' + ID, data: { id: ID, gift: view({ phase: 'day' }), now: o.at || AT, media: false, site: '' }, at: o.at || AT,
    store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([ID]) },
    respond: (url, opt) => url === '/rt/gift/' + ID && !opt.method ? { ok: true, own: true, gift: view({ phase: 'day' }), mine: { kids: 0, vd: 0, at: AT - 1, lk: 1 } }
      : url === '/rt/gift/' + ID + '/tower' && (opt.method || 'GET') === 'GET' ? { ok: true, tw: null, days: DAYS, taken: [], friends: 3, need: 10, gap: false, guest: true, prep: false, ...tower }
      : url === '/rt/gift/' + ID + '/tower' ? (o.book || (() => ({ ok: true, tw: { m: JSON.parse(opt.body).m, how: JSON.parse(opt.body).how } })))(JSON.parse(opt.body)) : null, ...o });
  const picker = (P) => P.all('select').find((n) => n.attrs['aria-label'] === '메인 타워에 올릴 1분');
  it('the owner\'s card: places left, friends k/10, the points button (or the account line for a guest)', async () => {
    const P = ownerPage({});
    try {
      await P.load('giftpage.js');
      assert.ok(P.heads().includes('🗽 메인 타워에 올리기'));
      assert.equal(P.says(/그날 남은 자리 30\/30/), true);
      assert.equal(P.says(/3\/10/), true);
      assert.ok(P.btn(/친구 응원 모으기/));
      assert.equal(P.says(/계정을 연결하면 포인트로 올릴 수 있어요/), true);
      assert.equal(P.btn(/2,000포인트로 올리기/), null, 'no points button for a guest');
      const get = P.sent.filter((s) => s.url === '/rt/gift/' + ID + '/tower');
      assert.deepEqual(get.map((s) => [s.method, s.auth]), [['GET', 'Bearer g1.test.token']], 'asked once, as the owner');
    } finally { P.done(); }
  });
  it('the card sits right after the link card', async () => {
    const P = ownerPage({});
    try {
      await P.load('giftpage.js');
      const hs = P.heads();
      assert.equal(hs.indexOf('🗽 메인 타워에 올리기'), hs.indexOf('🔗 링크 보내기') + 1);
    } finally { P.done(); }
  });
  it('an account: the points button; before the migration it says 준비 중; sold out says so', async () => {
    let P = ownerPage({ guest: false }); try { await P.load('giftpage.js'); assert.ok(P.btn(/2,000포인트로 올리기/)); } finally { P.done(); }
    P = ownerPage({ guest: false, prep: true }); try { await P.load('giftpage.js'); assert.equal(P.says(/포인트로 올리기는 준비 중이에요/), true); assert.equal(P.btn(/2,000포인트로 올리기/), null); } finally { P.done(); }
    P = ownerPage({ days: { [DAY]: { left: 0, mine: false } } }); try { await P.load('giftpage.js'); assert.equal(P.says(/그날 메인 타워는 매진이에요/), true); } finally { P.done(); }
    P = ownerPage({ days: { [DAY]: { left: 5, mine: true } } }); try { await P.load('giftpage.js'); assert.equal(P.says(/그날은 이미 다른 선물 전광판으로 메인 타워 1분을 골랐어요/), true); } finally { P.done(); }
  });
  it('no card when the Worker has no tower route (an older Worker) or the board\'s window is over', async () => {
    let P = fakeDom({ path: '/g/' + ID, data: { id: ID, gift: view({ phase: 'day' }), now: AT, media: false }, at: AT, store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([ID]) },
      respond: (url, opt) => (url === '/rt/gift/' + ID && !opt.method ? { ok: true, own: true, gift: view({ phase: 'day' }), mine: { kids: 0, vd: 0, at: AT - 1, lk: 1 } } : null) });
    try { await P.load('giftpage.js'); assert.equal(P.heads().includes('🗽 메인 타워에 올리기'), false); } finally { P.done(); }
    P = ownerPage({}, { at: KST('2026-11-26T09:00:00') });
    try { await P.load('giftpage.js'); assert.equal(P.heads().includes('🗽 메인 타워에 올리기'), false, 'closed'); } finally { P.done(); }
  });
  it('budget hard: no minutes to pick, a calm line; a booked minute still shows', async () => {
    let P = ownerPage({ hard: true, days: undefined, taken: undefined, friends: undefined });
    try { await P.load('giftpage.js'); assert.equal(P.says(/지금은 광장이 붐벼서/), true); assert.equal(P.btn(/친구 응원 모으기|포인트로 올리기/), null); } finally { P.done(); }
    P = ownerPage({ hard: true, tw: { m: M, how: 'friends' } });
    try { await P.load('giftpage.js'); assert.equal(P.says(/20:30에 메인 타워에 올라가요/), true); } finally { P.done(); }
  });
  it('fewer than 10 friends: the button shares the page', async () => {
    const P = ownerPage({});
    try {
      await P.load('giftpage.js');
      await P.press(P.btn(/친구 응원 모으기/));
      assert.equal(P.copied.length, 1); assert.match(P.copied[0], /https:\/\/sq\.example\/g\/abcd1234$/);
    } finally { P.done(); }
  });
  it('10 friends: pick a minute (on-the-hour and 21 o\'clock minutes are greyed), and it is booked', async () => {
    const P = ownerPage({ friends: 10 });
    try {
      await P.load('giftpage.js');
      assert.equal(P.says(/3\/10|10\/10/), false, 'the opened button says it is open');
      await P.press(P.btn(/시간 고르기/));
      const sel = picker(P);
      const opts = sel.kids.filter((n) => n.tag === 'option');
      assert.equal(opts.length, 360);
      assert.equal(opts.find((n) => n.textContent.startsWith('20:00')).disabled, true);
      assert.equal(opts.find((n) => n.textContent.startsWith('21:15')).disabled, true);
      assert.equal(opts.find((n) => n.textContent.startsWith('20:30')).disabled, false);
      assert.equal(sel.value, String(KST('2026-11-25T18:01:00')), 'the first free minute is chosen');
      sel.value = String(M);
      await P.press(P.btn(/이 1분으로 올리기/));
      assert.deepEqual(P.sent.filter((s) => s.url.endsWith('/tower') && s.method === 'POST').map((s) => s.body), [{ m: M, how: 'friends' }]);
      assert.equal(P.says(/20:30에 메인 타워에 올라가요/), true);
    } finally { P.done(); }
  });
  it('the picker leaves out minutes gone by and says 곧 시작 for those inside the five minutes', async () => {
    const P = ownerPage({ friends: 10 }, { at: KST('2026-11-25T18:30:30') });
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/시간 고르기/));
      const opts = picker(P).kids.filter((n) => n.tag === 'option');
      assert.equal(opts[0].textContent, '18:31 · 곧 시작'); assert.equal(opts[0].disabled, true);
      assert.equal(opts.some((n) => /^18:([0-2]\d|30)/.test(n.textContent)), false, 'gone by');
      assert.equal(opts.find((n) => !n.disabled).textContent, '18:36');
      assert.equal(opts.some((n) => /지난 시간/.test(n.textContent)), false);
    } finally { P.done(); }
  });
  it('one booking at a time: while it is out, 돌아가기 and a second press do nothing', async () => {
    let answer = null; const out = new Promise((r) => { answer = r; });
    const P = ownerPage({ guest: false }, { book: () => out });
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/2,000포인트로 올리기/));
      picker(P).value = String(M);
      const go = P.btn(/이 1분으로 올리기/), back = P.btn(/돌아가기/);
      const first = go.on.click[0]({}); await P.settle();
      assert.equal(back.disabled, true);
      await P.press(back); assert.ok(picker(P), 'still the picker');
      await P.press(go);
      answer({ ok: true, tw: { m: M, how: 'points' } }); await first; await P.settle();
      assert.equal(P.sent.filter((s) => s.url.endsWith('/tower') && s.method === 'POST').length, 1);
      assert.equal(P.says(/20:30에 메인 타워에 올라가요/), true);
    } finally { P.done(); }
  });
  it('the picker goes back to the card', async () => {
    const P = ownerPage({ friends: 10 });
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/시간 고르기/));
      await P.press(P.btn(/돌아가기/));
      assert.equal(picker(P), undefined); assert.ok(P.heads().includes('🗽 메인 타워에 올리기'));
    } finally { P.done(); }
  });
  it('points: the button says the price before it is pressed, and the POST carries how:points', async () => {
    const P = ownerPage({ guest: false });
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/2,000포인트로 올리기/));
      assert.equal(P.says(/누르면 응원 포인트 2,000이 바로 빠져요/), true);
      const sel = picker(P); sel.value = String(M);
      await P.press(P.btn(/이 1분으로 올리기/));
      assert.deepEqual(P.sent.filter((s) => s.url.endsWith('/tower') && s.method === 'POST').map((s) => s.body), [{ m: M, how: 'points' }]);
      assert.equal(P.says(/20:30에 메인 타워에 올라가요/), true);
    } finally { P.done(); }
  });
  it('a minute taken meanwhile: says so and greys it in the fresh list', async () => {
    const P = ownerPage({ friends: 10 }, { book: () => ({ ok: false, code: 'taken', error: '방금 다른 사람이 그 1분을 골랐어요. 다른 1분을 골라 주세요.', taken: [M], days: DAYS }) });
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/시간 고르기/));
      const sel = picker(P); sel.value = String(M);
      await P.press(P.btn(/이 1분으로 올리기/));
      assert.equal(P.says(/방금 다른 사람이 그 1분을 골랐어요/), true);
      const again = picker(P);
      assert.equal(again.kids.find((n) => n.value === String(M)).disabled, true); // h() puts value on the property, not an attribute
    } finally { P.done(); }
  });
  it('sold out meanwhile: the card says so with the refusal (no picker left to show)', async () => {
    const P = ownerPage({ friends: 10 }, { book: () => ({ ok: false, code: 'sold', error: '그날 메인 타워는 매진이에요.', days: { [DAY]: { left: 0, mine: false } } }) });
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/시간 고르기/));
      await P.press(P.btn(/이 1분으로 올리기/));
      assert.equal(picker(P), undefined);
      assert.equal(P.says(/그날 메인 타워는 매진이에요/), true);
    } finally { P.done(); }
  });
  it('another refusal: its words under the button, the picker stays', async () => {
    const P = ownerPage({ guest: false }, { book: () => ({ ok: false, code: 'poor', error: '포인트가 부족해요. 광장에서 방금 받은 포인트는 1분쯤 뒤에 반영돼요.' }) });
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/2,000포인트로 올리기/));
      await P.press(P.btn(/이 1분으로 올리기/));
      assert.equal(P.says(/포인트가 부족해요/), true); assert.ok(picker(P));
    } finally { P.done(); }
  });
  it('booked: a countdown; in the minute 지금 메인 타워에! with 광장에서 보기; after, 메인 타워에 올랐어요 · 20:30', async () => {
    for (const [now, re] of [[AT, /20:30에 메인 타워에 올라가요/], [M + 1000, /지금 메인 타워에!/], [M + 61000, /메인 타워에 올랐어요 · 20:30/]]) {
      const P = ownerPage({ tw: { m: M, how: 'friends' } }, { at: now });
      try { await P.load('giftpage.js'); assert.equal(P.says(re), true, String(re)); if (now === M + 1000) assert.equal(P.btn(/광장에서 보기/).attrs.href || P.btn(/광장에서 보기/).href, '/?gb=' + ID); else assert.equal(P.btn(/광장에서 보기/), null); } finally { P.done(); }
    }
  });
  it('the recipient page: the tower line from the public view; a heart before the day without a number', async () => {
    let P = pageOf(view({ tw: M }), M + 1000);
    try { await P.load('giftpage.js'); assert.equal(P.says(/지금 메인 타워에!/), true); } finally { P.done(); }
    P = pageOf(view({ tw: M }), M + 61000);
    try { await P.load('giftpage.js'); assert.equal(P.says(/메인 타워에 올랐어요 · 20:30/), true); } finally { P.done(); }
    P = pageOf(view({ day: '2026-11-30', a: KST('2026-11-30T18:00:00'), b: KST('2026-12-01T00:00:00') }), AT);
    try {
      await P.load('giftpage.js');
      const b = P.btn(/하트 보내기/); assert.ok(b, 'a heart before the day');
      assert.equal(/\d/.test(b.textContent), false);
      await P.press(b);
      assert.equal(P.sent.filter((s) => s.url.endsWith('/heart')).length, 1);
      assert.equal(/\d/.test(P.btn(/하트를 보냈어요/).textContent), false, 'no count before the reveal');
    } finally { P.done(); }
    P = pageOf(view({ day: '2026-11-30', a: KST('2026-11-30T18:00:00'), b: KST('2026-12-01T00:00:00'), tw: KST('2026-11-30T20:30:00') }), AT);
    try { await P.load('giftpage.js'); assert.equal(P.says(/20:30에 메인 타워에 올라가요/), true, 'before the day too'); } finally { P.done(); }
  });
  it('the public line never says how the minute was won', () => {
    const s = src('giftpage.js'), fn = s.slice(s.indexOf('function towerLine('), s.indexOf('function towerCard('));
    assert.ok(fn.length > 100);
    assert.doesNotMatch(fn, /포인트|친구 응원|how/);
  });
  it('the heart asks for a theart check when the page knows the site key: quietly (no tap card), fetched when shown, waited on 3 s at most', () => {
    const s = src('giftpage.js');
    assert.match(s, /human\(String\(DATA\.site\), 'theart', \{ ms: HEART_TS \}\)/);
    assert.match(s, /const HEART_WAIT_MS = 3000, HEART_TS = \{ load: 3000, run: 5000, tap: 0 \};/);
  });
  it('💖 goes with keepalive and is marked on this device once it is sent, not before', async () => {
    const g = view({ day: '2026-11-30', a: KST('2026-11-30T18:00:00'), b: KST('2026-12-01T00:00:00') });
    let seen = null;
    const P = pageOf(g, AT, { respond: (u, opt) => { if (!u.endsWith('/heart')) return null; seen = { keep: opt.keepalive, marked: g.id in JSON.parse(P.store.kts_ghearts || '{}') }; return { ok: true }; } });
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/하트 보내기/));
      assert.deepEqual(seen, { keep: true, marked: false });
      assert.ok(g.id in JSON.parse(P.store.kts_ghearts || '{}'), 'marked once sent');
    } finally { P.done(); }
  });
  it('💖 with Turnstile on: a check that does not answer in 3 s does not lose the heart (it goes without a token)', async () => {
    const g = view({ day: '2026-11-30', a: KST('2026-11-30T18:00:00'), b: KST('2026-12-01T00:00:00') });
    const P = fakeDom({ path: '/g/' + g.id, data: { id: g.id, gift: g, now: AT, media: false, site: '0x4AAAAtest' }, at: AT, store: { masil_gt: GUEST() }, respond: (u) => (u.endsWith('/heart') ? { ok: true } : null) });
    try {
      await P.load('giftpage.js');
      const press = P.btn(/하트 보내기/).on.click[0]({}); await P.settle();
      assert.equal(P.sent.some((s) => s.url.endsWith('/heart')), false, 'waiting for the check');
      assert.ok(P.timeouts.some((t) => t.ms === 3000), 'a short cap');
      await P.timers(); await press; await P.settle();
      const sent = P.sent.filter((s) => s.url.endsWith('/heart'));
      assert.equal(sent.length, 1); assert.equal('ts' in sent[0].body, false);
      assert.match(P.btn(/하트를 보냈어요/).textContent, /^💖 하트를 보냈어요$/);
    } finally { P.done(); }
  });
  it('gift.html preloads towerrules.js with no query; giftpage.js imports it so', () => {
    assert.match(src('gift.html'), /<link rel="modulepreload" href="\/giftrules\.js" \/>\n<link rel="modulepreload" href="\/towerrules\.js" \/>/);
    assert.match(src('giftpage.js'), /from '\.\/towerrules\.js';/);
  });
});
