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
let LOADS = 0;
function fakeDom({ path = '/gift', search = '', data = null, store = {}, at = 0, respond = () => ({}) } = {}) {
  const sent = [], timeouts = [], ticks = [], winOn = {}, swOn = {}, copied = [], shared = [], P = { sent, store, copied, shared, winOn, swOn, skew: at ? at - Date.now() : 0 };
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
      focus() { doc.activeElement = n; }, matches: () => false, getContext: () => ink, canPlayType: () => '', play: () => Promise.resolve(), pause() {}, showPicker() {},
    });
    Object.defineProperty(n, 'textContent', { get: () => n.kids.map((k) => k.textContent).join(''), set(v) { n.replaceChildren(); if (v != null && v !== '') n.append(String(v)); } });
    Object.defineProperty(n, 'isConnected', { get: () => { for (let x = n; x; x = x.parent) if (x === app || x === doc.body) return true; return false; } });
    return n;
  };
  const app = el('main'), dataTag = data ? { textContent: JSON.stringify(data) } : null, toolWish = el('button');
  const doc = { getElementById: (id) => (id === 'app' ? app : id === 'gift-data' ? dataTag : id === 'view' ? el('canvas') : null), createElement: el, createTextNode: text, querySelector: () => toolWish,
    documentElement: { classList: { add() {} } }, head: el('head'), body: el('body'), activeElement: null, hidden: false, addEventListener() {}, removeEventListener() {} };
  el('div').append(toolWish); // the HUD's 🌠 button has a parent (gift.js puts 🎁 after it)
  const loc = { pathname: path, search, hash: '', origin: 'https://sq.example', reloads: 0, reload() { loc.reloads++; }, get href() { return loc.origin + loc.pathname + loc.search; }, set href(v) { loc.went = String(v); } };
  const go = (url) => { const u = new URL(String(url), loc.origin); loc.pathname = u.pathname; loc.search = u.search; };
  const win = { addEventListener(t, f) { (winOn[t] ||= []).push(f); }, removeEventListener() {}, scrollTo() {}, postMessage() {} }; win.parent = win;
  const realNow = Date.now;
  const globals = {
    document: doc, window: win, location: loc, history: { scrollRestoration: 'auto', pushState: (s, t, url) => go(url), replaceState: (s, t, url) => go(url) },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); } },
    navigator: { userAgent: 'test', sendBeacon: () => true, clipboard: { async writeText(t) { copied.push(String(t)); } }, share: null, serviceWorker: { addEventListener(t, f) { swOn[t] = f; } } },
    fetch: async (url, opt = {}) => { sent.push({ url: String(url), method: opt.method || 'GET', body: typeof opt.body === 'string' ? JSON.parse(opt.body) : opt.body, auth: opt.headers?.authorization || '' }); const r = respond(String(url), opt); return { ok: !!r, status: r ? 200 : 404, json: async () => r || { ok: false }, blob: async () => new Blob([]) }; },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, scrollTo() {}, scrollY: 0, matchMedia: () => ({ matches: false }),
    setInterval: (f) => { ticks.push(f); return 0; }, clearInterval() {}, setTimeout: (f, ms) => { timeouts.push({ f, ms }); return 0; }, clearTimeout() {},
  };
  const before = Object.fromEntries(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  Date.now = () => realNow() + P.skew;
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const walk = (n, out = []) => { if (n.nodeType === 1) { out.push(n); for (const k of n.kids) walk(k, out); } return out; };
  const shown = (n) => { for (let x = n; x; x = x.parent) if (x.hidden) return false; return true; };
  Object.assign(P, {
    app, doc, loc, settle, shown,
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
    assert.deepEqual(OCC_KEYS, ['bday', 'anniv', 'pass', 'cheer', 'just', 'thanks'], 'the five days people pick first, then 고마움');
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
    assert.equal(plazaLook(g, KST('2026-11-25T00:00:00')), 'replay', 'the day has come: a preview');
    assert.equal(plazaLook(g, KST('2026-11-25T10:00:00')), 'replay');
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
    const g = view();
    let P = pageOf(g, KST('2026-11-25T10:00:00'));
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/영상 건너뛰기/));
      const go = P.btn(/^🗽/);
      assert.equal(go.textContent, '🗽 광장에서 미리 보기'); assert.equal(go.href, '/?gb=' + g.id);
      P.skew += 9 * 36e5; P.tick(); assert.equal(go.textContent, '🗽 직접 가서 보기'); // 19:00
      P.skew += 6 * 36e5; P.tick(); assert.equal(go.textContent, '🗽 광장에서 다시 보기'); // 01:00, the window is over
      await P.press(go); assert.equal(P.seen(g.id, 'go'), true, 'counted as before');
    } finally { P.done(); }
    P = pageOf(view({ phase: 'before' }), KST('2026-11-24T12:00:00'));
    try { await P.load('giftpage.js'); assert.deepEqual(P.heads('h1'), ['🎂 민지님을 위한 선물 전광판']); assert.equal(P.btn(/^🗽/), null); assert.equal(P.btn(/답장|고마워 전광판/), null, 'nothing to answer before the day'); } finally { P.done(); }
  });
  // The plaza side (gift.js) with a world that only records what it is asked to do.
  async function plaza({ at, search = '?gb=abcd1234', gift = null, list = null } = {}) {
    const P = fakeDom({ path: '/', search, at, store: { masil_gt: GUEST() }, respond: (u) => (/^\/rt\/gift\/[0-9a-z]{8}$/.test(u) && gift ? { ok: true, gift, own: false } : null) });
    P.notes = []; P.calls = [];
    const world = { pinGift: (g, ms) => { P.calls.push(['pin', g.id, ms]); return 'STREET_40'; }, goToSlot: (s) => P.calls.push(['go', s]), focusSlot: (s) => P.calls.push(['focus', s]), cheerAt: (s) => P.calls.push(['cheer', s]), setGifts() {}, setInputEnabled() {} };
    const { mountGift } = await P.load('gift.js');
    P.gift = mountGift({ world, ui: { note: (t, k, fn) => P.notes.push({ t, k, fn }) }, whenBuilt: (f) => f(), introDone() {} });
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
    P = await plaza({ at: KST('2026-11-25T10:00:00'), gift: view({ phase: 'day' }) });
    try {
      P.gift.arrive(); await P.settle(); await P.timers();
      assert.deepEqual(P.calls, SHOWN); assert.equal(P.notes[0].t, '🎁 민지님을 위한 선물 전광판이에요 · 광장에는 저녁 6시에 걸려요');
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
      P.swOn.message({ data: { t: 'push', url: '/g/abcd1234' } });
      assert.equal(frames().length, 1); assert.equal(frames()[0].kids.find((n) => n.tag === 'iframe').src, '/g/abcd1234?in=1');
      P.swOn.message({ data: { t: 'push', url: '/g/abcd1234' } }); assert.equal(frames().length, 1, 'one frame');
    } finally { P.done(); }
  });
});

describe('the owner page leads with the real video only when the Worker stores videos', () => {
  const g = view(), URL_ = 'https://sq.example/g/' + g.id, REC = '/?gb=' + g.id + '&rec=1';
  const own = (o = {}, store = {}) => pageOf(o.gift || g, KST('2026-11-25T19:00:00'), { store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([g.id]), ...store },
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
      assert.deepEqual(P.heads(), ['🎬 15초 축하 영상', '🔗 링크 보내기', '✨ 더 크게, 더 오래 걸고 싶다면', '📊 지금까지']);
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
        assert.deepEqual(P.heads(), ['🔗 링크 보내기', '✨ 더 크게, 더 오래 걸고 싶다면', '🎬 15초 축하 영상', '📊 지금까지']);
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
    assert.match(TIERS[3].items.join(), /메인 타워와 따로/, 'the parade is not the fans\' 9 pm main tower');
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
