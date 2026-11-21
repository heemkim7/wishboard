import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createBackKeeper, createInputLock, sheetPlan, draftAtRisk, toastMs, toastText, pushRoute, proofOffers, awayRead, TOAST, SHEET_MAX, SPARE_MS } from '../overlay.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// A browser history where traversals are asynchronous, as in a real one: go() only queues, land() delivers it relative to
// the entry that is current at that moment and fires popstate.
function rig({ state = null } = {}) {
  const hist = {
    entries: [{ state }], i: 0, queue: [], left: false,
    get state() { return this.entries[this.i].state; },
    pushState(s) { this.entries.length = this.i + 1; this.entries.push({ state: s }); this.i += 1; },
    replaceState(s) { this.entries[this.i].state = s; },
    go(d) { this.queue.push(d); },
  };
  const tasks = [], timers = [], acts = [];
  const keeper = createBackKeeper({
    hist,
    later: (fn) => tasks.push(fn),
    timer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clear: (t) => { const k = timers.indexOf(t); if (k >= 0) timers.splice(k, 1); },
  });
  const ui = { depth: 0 };
  const tick = () => { while (tasks.length) tasks.shift()(); };
  const popstate = () => {
    const act = keeper.pop();
    acts.push(act);
    if (act.back) { ui.depth = Math.max(0, ui.depth - act.back); keeper.want(ui.depth); }
    tick();
  };
  const land = (max = Infinity) => {
    while (hist.queue.length && max-- > 0) {
      const n = hist.i + hist.queue.shift();
      if (n < 0) { hist.left = true; continue; }
      hist.i = Math.min(n, hist.entries.length - 1);
      popstate();
    }
  };
  return {
    hist, keeper, ui, acts, timers,
    tick,
    // The player's own actions start with a tap (pointerup runs before the click that opens or closes something).
    tap() { keeper.touch(); },
    enter() { keeper.touch(); keeper.arm(); },
    open() { keeper.touch(); ui.depth += 1; keeper.want(ui.depth); },
    close(n = 1) { keeper.touch(); ui.depth = Math.max(0, ui.depth - n); keeper.want(ui.depth); },
    // Something that opens by itself (a queued offer, the proof bar after the celebration): no tap.
    sysOpen() { ui.depth += 1; keeper.want(ui.depth); },
    land,
    // The player's back gesture: it lands, together with anything queued before it; what it sets off stays in flight.
    back() { hist.go(-1); land(hist.queue.length); },
    forward() { hist.i = Math.min(hist.i + 1, hist.entries.length - 1); popstate(); },
    fire(ms) { for (const t of timers.filter((x) => x.ms === ms)) { timers.splice(timers.indexOf(t), 1); t.fn(); } tick(); },
    where() { const k = hist.state?.kts; return k ? `${k.g ? 'g' : ''}${k.o || ''}` || 'g?' : 'base'; },
    tags() { return hist.entries.map((e) => (e.state?.kts ? `${e.state.kts.g ? 'g' : ''}${e.state.kts.o || ''}` : 'base')); },
  };
}

describe('history bookkeeping (createBackKeeper)', () => {
  it('open, ✕-close: one entry while open, none left behind, however often', () => {
    const r = rig();
    r.enter(); r.tick();
    assert.deepEqual(r.tags(), ['base', 'g']);
    for (let n = 0; n < 5; n++) {
      r.open(); r.tick();
      assert.equal(r.where(), 'g1');
      r.close(); r.tick();
      assert.deepEqual(r.hist.queue, [], 'the entry stays as a spare for a moment');
      r.fire(SPARE_MS);
      assert.deepEqual(r.hist.queue, [-1], 'then our own back is in flight');
      assert.equal(r.keeper.state().pending, 1);
      r.land();
      assert.equal(r.where(), 'g');
      assert.equal(r.keeper.state().pending, 0);
    }
    assert.deepEqual(r.acts.filter((a) => !a.own), [], 'every popstate was our own traversal');
    // After five ✕-closes the very next back is the plaza's own (the exit notice), not a dead press.
    r.back();
    assert.deepEqual(r.acts.at(-1), { exit: true });
  });

  it('back closes the open sheet and leaves the player on the guard entry', () => {
    const r = rig();
    r.enter(); r.open(); r.tick();
    r.back();
    assert.deepEqual(r.acts.at(-1), { back: 1 });
    assert.equal(r.ui.depth, 0);
    assert.equal(r.where(), 'g');
    assert.deepEqual(r.hist.queue, []);
    assert.equal(r.keeper.state().spare, false);
  });

  it('close and reopen in the same tick (purchase → proof bar) reuses the entry: no back, no push', () => {
    const r = rig();
    r.enter(); r.open(); r.tick();
    const before = r.hist.entries.length;
    r.close(); r.open(); // closeSheet(); showProof();
    r.tick();
    r.fire(SPARE_MS);
    assert.deepEqual(r.hist.queue, []);
    assert.equal(r.hist.entries.length, before);
    assert.equal(r.where(), 'g1');
    assert.equal(r.ui.depth, 1);
    // …and back then closes the proof bar.
    r.back();
    assert.deepEqual(r.acts.at(-1), { back: 1 });
    assert.equal(r.where(), 'g');
  });

  it('whatever opens within the spare time (a queued offer, the next sheet) reuses the entry too', () => {
    const r = rig();
    r.enter(); r.open(); r.tick();
    r.close(); r.tick(); // ✕
    r.open(); r.tick(); // 1.5 s later a prompt opens by itself: no pushState without a tap
    assert.deepEqual(r.tags(), ['base', 'g', 'g1']);
    assert.deepEqual(r.hist.queue, []);
    r.fire(SPARE_MS); // the spare timer finds the entry in use
    assert.deepEqual(r.hist.queue, []);
    assert.equal(r.where(), 'g1');
  });

  it('a back gesture inside the spare time still means back: the exit notice, or the parent under a closed child', () => {
    const r = rig();
    r.enter(); r.open(); r.tick();
    r.close(); r.tick(); // ✕, the spare entry is still there
    r.back(); // lands on the guard: nothing was on screen, so this is the plaza's own back
    assert.deepEqual(r.acts.at(-1), { exit: true });
    assert.deepEqual(r.hist.queue, [-1], 'we step down to the base entry ourselves, so a second back leaves');
    r.land();
    assert.equal(r.where(), 'base');
    assert.equal(r.keeper.state().exiting, true);
    r.fire(SPARE_MS);
    assert.equal(r.where(), 'base', 'the guard is not put back inside the exit window');
    r.tap(); r.tick();
    assert.equal(r.where(), 'base', 'not even after a tap: a second back inside the window still leaves');
    r.fire(2000);
    assert.equal(r.where(), 'g');

    const s = rig();
    s.enter(); s.open(); s.tick(); s.open(); s.tick();
    s.close(); s.tick(); // ✕ on the child
    s.back(); // lands on the parent's entry
    assert.deepEqual(s.acts.at(-1), { back: 1 });
    assert.equal(s.ui.depth, 0, 'the parent closed');
    s.fire(SPARE_MS); s.land();
    assert.equal(s.where(), 'g');
  });

  it('an overlay opened while our own back is in flight survives it and gets its entry afterwards', () => {
    const r = rig();
    r.enter(); r.open(); r.tick();
    r.close(); r.tick(); r.fire(SPARE_MS); // history.go(-1) queued
    r.open(); r.tick(); // something opens before the traversal lands: nothing is pushed yet
    assert.equal(r.where(), 'g1', 'still on the old entry');
    assert.equal(r.hist.entries.length, 3);
    r.land();
    assert.deepEqual(r.acts.at(-1), { own: true });
    assert.equal(r.ui.depth, 1, 'the new overlay was not closed by our own popstate');
    assert.equal(r.where(), 'g', 'and nothing is pushed straight after a traversal');
    r.tap(); r.tick(); // its entry comes with the next tap
    assert.equal(r.where(), 'g1');
    assert.deepEqual(r.tags(), ['base', 'g', 'g1']);
  });

  it('a child sheet has its own entry: back pops one level, ✕ pops one level, closing all goes back in one step', () => {
    const r = rig();
    r.enter(); r.open(); r.tick(); r.open(); r.tick();
    assert.deepEqual(r.tags(), ['base', 'g', 'g1', 'g2']);
    r.back();
    assert.deepEqual(r.acts.at(-1), { back: 1 });
    assert.equal(r.ui.depth, 1);
    assert.equal(r.where(), 'g1');
    assert.deepEqual(r.hist.queue, [], 'nothing is pushed after a back gesture');
    r.open(); r.tick();
    r.close(); r.tick(); r.fire(SPARE_MS); r.land(); // ✕ on the child
    assert.equal(r.where(), 'g1');
    r.open(); r.tick();
    r.close(2); r.tick(); r.fire(SPARE_MS); // closeSheet(): both levels
    assert.deepEqual(r.hist.queue, [-2]);
    r.land();
    assert.equal(r.where(), 'g');
    assert.equal(r.acts.filter((a) => a.back).length, 1);
  });

  it('first back from the plaza asks, the guard returns after the window at the next tap, a second back inside it leaves', () => {
    const r = rig();
    r.enter(); r.tick();
    r.back();
    assert.deepEqual(r.acts.at(-1), { exit: true });
    assert.equal(r.where(), 'base');
    assert.equal(r.keeper.state().exiting, true);
    r.fire(2000);
    assert.equal(r.keeper.state().exiting, false);
    assert.equal(r.where(), 'base', 'no pushState without a gesture after the back');
    r.tap(); r.tick();
    assert.equal(r.where(), 'g');
    r.back();
    assert.deepEqual(r.acts.at(-1), { exit: true });
    r.back(); // inside the window nothing of ours is above the base entry: the browser leaves
    assert.equal(r.hist.left, true);
  });

  it('nothing is pushed without a gesture after a traversal; a self-opened sheet still closes on back', () => {
    const r = rig();
    r.enter(); r.open(); r.tick();
    r.back(); // the sheet closes, we are on the guard
    const n = r.hist.entries.length;
    r.sysOpen(); r.tick(); // an offer opens by itself right after
    assert.equal(r.where(), 'g', 'no entry yet');
    r.back(); // back before touching anything: one entry lower, the offer still closes
    assert.deepEqual(r.acts.at(-1), { back: 1 });
    assert.equal(r.ui.depth, 0);
    assert.equal(r.where(), 'base');
    r.tap(); r.tick(); // the guard comes back with the next tap
    assert.equal(r.where(), 'g');
    assert.equal(r.hist.entries.length, n - 1);

    const s = rig();
    s.enter(); s.open(); s.tick();
    s.back();
    s.sysOpen(); s.tick();
    s.tap(); s.tick(); // the player touches the offer: now it has its entry
    assert.equal(s.where(), 'g1');
    s.back();
    assert.deepEqual(s.acts.at(-1), { back: 1 });
    assert.equal(s.where(), 'g');

    // Before any gesture at all (a page that entered by itself) nothing is pushed either.
    const q = rig();
    q.keeper.arm(); q.sysOpen(); q.tick();
    assert.deepEqual(q.tags(), ['base']);
  });

  it('opening something inside the exit window puts the guard and the overlay back at once', () => {
    const r = rig();
    r.enter(); r.tick();
    r.back();
    r.open(); r.tick();
    assert.deepEqual(r.tags(), ['base', 'g', 'g1']);
    assert.equal(r.keeper.state().exiting, false);
    assert.equal(r.timers.filter((t) => t.ms === 2000).length, 0);
  });

  it('no guard before the plaza is entered; one armed under an open sheet arrives when the sheet closes', () => {
    const r = rig();
    r.open(); r.tick();
    assert.deepEqual(r.tags(), ['base', '1']);
    r.back();
    assert.deepEqual(r.acts.at(-1), { back: 1 });
    r.back();
    assert.equal(r.hist.left, true, 'on the boot screen back leaves as before');

    const s = rig();
    s.open(); s.tick();
    s.enter(); s.tick();
    assert.deepEqual(s.tags(), ['base', '1'], 'nothing can be inserted under the open sheet');
    s.close(); s.tick(); s.fire(SPARE_MS); s.land();
    s.tap(); s.tick();
    assert.deepEqual(s.tags(), ['base', 'g']);
    assert.equal(s.where(), 'g');
  });

  it('forward onto a spent overlay entry steps back off it', () => {
    const r = rig();
    r.enter(); r.open(); r.tick();
    r.back();
    r.forward();
    assert.deepEqual(r.acts.at(-1), {});
    assert.deepEqual(r.hist.queue, [-1]);
    r.land();
    assert.equal(r.where(), 'g');
    assert.equal(r.ui.depth, 0);
  });

  it('a reload on an overlay entry starts clean, and a lost traversal does not block later pushes', () => {
    const r = rig({ state: { keep: 1, kts: { g: 1, o: 2 } } });
    assert.deepEqual(r.hist.state, { keep: 1, kts: { g: 1, o: 0 } });
    const s = rig();
    s.enter(); s.open(); s.tick();
    s.close(); s.tick(); s.fire(SPARE_MS);
    s.hist.queue.length = 0; // the traversal never reports back
    s.open(); s.tick();
    assert.equal(s.keeper.state().pending, 1);
    s.fire(1500);
    assert.equal(s.keeper.state().pending, 0);
    assert.equal(s.where(), 'g1');
  });

  it('keeps whatever else is in history.state', () => {
    const r = rig({ state: { other: 7 } });
    r.enter(); r.open(); r.tick();
    assert.deepEqual(r.hist.state, { other: 7, kts: { g: 1, o: 1 } });
  });

  it('ui.js drives it: ✕ and Escape go back one level, nothing calls history.back() by hand', () => {
    const ui = read('ui.js');
    assert.match(ui, /class: 'x', type: 'button', 'aria-label': '닫기', onclick: \(\) => backSheet\(\)/);
    assert.match(ui, /else if \(sheet\) backSheet\(\);/);
    assert.equal(/history\.(back|go|pushState)\(/.test(ui), false);
    assert.match(ui, /function syncBack\(\) \{ backKeeper\.want\(sheets\.length \+ proofLevel\(\)\); \}/);
    assert.match(ui, /addEventListener\('pointerup', \(\) => backKeeper\.touch\(\), true\);/);
    assert.match(ui, /const proofLevel = \(\) => \(!proof\.hidden \|\| \(proofWait && !proofWait\.skip\) \? 1 : 0\);/);
    assert.match(ui, /note\('한 번 더 누르면 나가요', '', null, \{ ms: 2000 \}\)/);
    assert.equal(/keyboard\.lock/.test(ui), false, 'Escape is never locked');
    assert.match(ui, /if \(!byUser && !coarse\) return;/);
    assert.equal(/endDance\(true\)[^\n]*fullscreenchange|fullscreenchange[^\n]*endDance/.test(ui), false, 'leaving fullscreen does not end a dance');
  });
});

describe('sheet stack', () => {
  it('a different sheet is a child, the same sheet re-renders, a sheet further down is returned to', () => {
    assert.deepEqual(sheetPlan([], '설정'), { pop: 0, replace: false });
    assert.deepEqual(sheetPlan(['전광판 점령'], '소속'), { pop: 0, replace: false });
    assert.deepEqual(sheetPlan(['전광판 걸기'], '전광판 걸기'), { pop: 0, replace: true });
    assert.deepEqual(sheetPlan(['전광판 점령', '내 전광판 리포트'], '전광판 점령'), { pop: 1, replace: true });
    assert.deepEqual(sheetPlan(['holds'], '내 전광판'), { pop: 0, replace: false }, 'my boards and a board card share a title, not a kind');
    const deep = Array.from({ length: SHEET_MAX }, (_, i) => 's' + i);
    assert.deepEqual(sheetPlan(deep, 'new'), { pop: 0, replace: true });
  });
  it('a backdrop tap is held back only by typing that is still there', () => {
    assert.equal(draftAtRisk(false, ['prefilled']), false);
    assert.equal(draftAtRisk(true, ['', '  ']), false);
    assert.equal(draftAtRisk(true, ['', '우리 가게']), true);
  });
  it('ui.js: a child hides its parent instead of removing it, and focus moves in and back', () => {
    const ui = read('ui.js');
    assert.match(ui, /s\.el\.classList\.toggle\('under', under\);/);
    assert.match(ui, /if \(!draftAtRisk\(s\.typed, values\)\) \{ backSheet\(\); return; \}/);
    assert.match(ui, /box\.focus\(\{ preventScroll: true \}\)/);
    assert.match(ui, /back\.focus\(\{ preventScroll: true \}\)/);
    assert.match(read('index.html'), /\.modal\.under \{ visibility: hidden; \}/);
  });
});

describe('input lock', () => {
  it('unlocks only when no owner is left', () => {
    const seen = [];
    const lock = createInputLock((on) => seen.push(on));
    lock.set('sheet', true);
    lock.set('proof', true);
    lock.set('sheet', false);
    assert.equal(lock.locked(), true, 'the proof bar still holds it');
    assert.equal(seen.at(-1), true);
    lock.set('proof', false);
    assert.equal(seen.at(-1), false);
    lock.set('sheet', false); // unlocking twice is harmless
    assert.equal(lock.locked(), false);
    lock.set(undefined, true); // a caller with no owner (the photo countdown)
    lock.set('bake', true);
    lock.set(undefined, false);
    assert.deepEqual(lock.owners(), ['bake']);
  });
  it('ui.js names its owners', () => {
    const ui = read('ui.js');
    for (const owner of ['sheet', 'proof', 'bake', 'dance']) assert.match(ui, new RegExp(`hooks\\.lockInput\\??\\.?\\((true|false|sheets\\.length > 0), '${owner}'\\)`), owner);
    assert.match(ui, /hooks\.lockInput = \(on, owner\) => inputLock\.set\(owner, !!on\);/);
  });
});

describe('toasts', () => {
  it('stay longer for longer text, at most 7 s; a tappable one at least 8 s', () => {
    assert.equal(toastMs(''), TOAST.base);
    assert.equal(toastMs('가'.repeat(10)), 2500 + 600);
    assert.equal(toastMs('가'.repeat(200)), 7000);
    assert.equal(toastMs('짧아요', true), 8000);
    assert.equal(toastMs('가'.repeat(200), true), 8000);
    assert.ok(toastMs('😀😀') < toastMs('abcdef'), 'counts characters, not UTF-16 units');
  });
  it('a raw English error is said in Korean; everything else is left alone', () => {
    assert.equal(toastText('Failed to fetch', 'err'), '연결이 불안정해요. 잠시 뒤 다시 해 주세요');
    assert.equal(toastText('tribe', 'err'), '처리하지 못했어요. 잠시 뒤 다시 해 주세요');
    assert.equal(toastText('코인이 부족해요', 'err'), '코인이 부족해요');
    assert.equal(toastText('GOOD!', 'ok'), 'GOOD!');
    assert.equal(toastText(null), '');
  });
  it('ui.js keeps note(text, kind, onClick) and marks tappable ones; index.html moves them up over a sheet', () => {
    const ui = read('ui.js');
    assert.match(ui, /function note\(text, kind = '', onClick, opts\)/);
    assert.match(ui, /toastMs\(say, !!click\)/);
    assert.match(ui, /click \? h\('i', \{ class: 'go', 'aria-hidden': 'true' \}, icon\('chevronRight'\)\) : null/);
    assert.match(read('index.html'), /body\.has-sheet \.toasts, body\.has-proof \.toasts \{ top: calc\(var\(--app-top, 0px\) \+ 10px \+ var\(--safe-t\)\); bottom: auto !important;/);
  });
});

describe('notification click', () => {
  it('routes focus and wish links, and nothing else', () => {
    const origin = 'https://sq.example';
    assert.deepEqual(pushRoute('/?focus=STREET_5', origin), { kind: 'focus', slot: 'STREET_5' });
    assert.deepEqual(pushRoute('/?focus=MAIN_TOP&ref=abc', origin), { kind: 'focus', slot: 'MAIN_TOP' });
    assert.deepEqual(pushRoute('/?wish=abcde12345', origin), { kind: 'wish', id: 'abcde12345' });
    assert.deepEqual(pushRoute('https://sq.example/?wish=abcde12345', origin), { kind: 'wish', id: 'abcde12345' });
    for (const bad of ['/', '', null, '/?focus=<script>', '/?wish=ABC', 'https://evil.example/?focus=STREET_5', '//evil.example/?focus=STREET_5', 'javascript:alert(1)']) {
      assert.deepEqual(pushRoute(bad, origin), { kind: 'none' }, String(bad));
    }
  });
  it('main.js handles the message in place and sw.js never navigates an open game', () => {
    const main = read('main.js');
    assert.match(main, /navigator\.serviceWorker\?\.addEventListener\('message', \(e\) => \{ if \(e\.data\?\.t === 'push'\) onPushClick\(e\.data\.url\); \}\)/);
    const sw = read('sw.js');
    assert.equal(/\.navigate\(/.test(sw), false);
    assert.match(sw, /c\.postMessage\(\{ t: 'push', url \}\)/);
  });
});

describe('proof bar', () => {
  it('carries the link offer for a guest and the push offer while the browser has not answered', () => {
    const base = { ready: true, guest: true, linked: false, gift: '', slot: 'STREET_8', pushSupported: true, permission: 'default' };
    assert.deepEqual(proofOffers(base), { link: true, push: true });
    assert.deepEqual(proofOffers({ ...base, guest: false, linked: true }), { link: false, push: true });
    assert.deepEqual(proofOffers({ ...base, ready: false }), { link: false, push: true });
    assert.equal(proofOffers({ ...base, permission: 'granted' }).push, false);
    assert.equal(proofOffers({ ...base, permission: 'denied' }).push, false);
    assert.equal(proofOffers({ ...base, pushSupported: false }).push, false);
    assert.equal(proofOffers({ ...base, gift: '민지' }).push, false, 'a gift is not mine to lose');
    assert.equal(proofOffers({ ...base, slot: 'PLOT_3' }).push, false, 'a plot cannot be taken');
  });
  it('ui.js has one way out that always unlocks, ends the focus camera and settles history', () => {
    const ui = read('ui.js');
    const fn = ui.slice(ui.indexOf('function leaveProof('), ui.indexOf('async function proofShot()'));
    assert.match(fn, /\} finally \{\s*hooks\.lockInput\?\.\(false, 'proof'\);\s*if \(!keepFocus\) hooks\.endFocus\?\.\(\);\s*syncBack\(\);\s*\}/);
    assert.equal(ui.includes('dismissProof'), false);
    const shot = ui.slice(ui.indexOf('async function proofShot()'), ui.indexOf('async function recordClip()'));
    assert.ok(shot.indexOf('leaveProof(') < shot.indexOf('openShot({ slot })'), 'the photo button leaves the bar, then opens the photo sheet');
    assert.match(ui, /text: '5초 영상 저장', onclick: \(\) => recordClip\(\)/);
    assert.match(ui, /recText\.textContent = `녹화 중 \$\{left\}`/);
    assert.match(ui, /text: '취소', onclick: \(\) => clipStop\?\.\(\)/);
    assert.equal(/queuePushOffer\('claim'\)/.test(ui), false, 'the claim moment asks on the bar, not with a sheet');
  });
  it('the chain upsell waits for the bar, and a taken board is a notice, never a sheet', () => {
    const ui = read('ui.js');
    assert.match(ui, /if \(nxt && up\) \{\s*proofNext = \(\) => openSheet\('연속 점령', 'CHAIN'/);
    assert.equal(ui.includes("openSheet('전광판을 빼앗겼어요'"), false);
    assert.match(ui, /note\(`\$\{t\.by\}님이 \$\{slotName\(t\.slot\)\}을 가져갔어요 · 되찾기`, 'err', \(\) => retake\(t\)\)/);
    const main = read('main.js');
    assert.match(main, /world\.focusSlot\(slot, \{ celebrate: true \}\)/);
    assert.equal(main.includes('ui.revenge('), false);
  });
});

describe('다녀간 사이: what a close marks as read', () => {
  const taken = { kind: 'taken', id: 9, slot: 'STREET_5', also: [4] };
  const look = { kind: 'look', id: 8, slot: 'SUB_2', also: [] };
  const wish = { kind: 'wish', id: 0 };
  const prize = { kind: 'prize', id: 0 };
  const plan = { rows: [taken, look, wish, prize], inboxIds: [9, 4, 8, 3], wishSeen: { id: 'w', hearts: 5 }, prizeDay: '2026-11-21', invSeen: 0 };
  it('an explicit close reads everything shown', () => {
    assert.deepEqual(awayRead(plan, [], true), { inboxIds: [9, 4, 8, 3], wishSeen: plan.wishSeen, prizeDay: '2026-11-21', invSeen: 0 });
  });
  it('leaving through one row reads that row only (with the older rows folded under it)', () => {
    assert.deepEqual(awayRead(plan, [look], false), { inboxIds: [8], wishSeen: null, prizeDay: '', invSeen: 0 });
    assert.deepEqual(awayRead(plan, [taken, wish], false), { inboxIds: [9, 4], wishSeen: plan.wishSeen, prizeDay: '', invSeen: 0 });
    assert.deepEqual(awayRead(plan, [], false), { inboxIds: [], wishSeen: null, prizeDay: '', invSeen: 0 });
    assert.deepEqual(awayRead(null, null, false), { inboxIds: [], wishSeen: null, prizeDay: '', invSeen: 0 });
  });
});
