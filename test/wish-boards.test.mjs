// 오늘의 소원 on idle billboards: the pure rules behind the rotation (ts3d/art.js imports cleanly in Node; screens.js needs three).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wishGlyphs, wishLines, wishOrd, wishStep, wishIndex, wishRotates, wishStrip, cleanWishes, sameWishes, rowUntil, wishWork, wishPick, wishPinPick, wishPinPlan, wishPlan, wishRelist, wishFontTargets, freshWish, wishSettled, WISH_CYCLE, WISH_CYCLE_LOW, WISH_BUDGET, WISH_BUDGET_LOW, WISH_TICK_MS, WISH_SETTLE_MS, WISH_START, WISH_NOW, WISH_DROPS } from '../ts3d/art.js';
import { SLOT_IDS } from '../balance.js';

const cps = (s) => Array.from(s).length;
const future = new Date(Date.now() + 36e5).toISOString();
const past = new Date(Date.now() - 36e5).toISOString();

describe('wish card wrap', () => {
  it('keeps a short wish on one line', () => {
    assert.deepEqual(wishLines('합격하게 해 주세요'), ['합격하게 해 주세요']);
    assert.deepEqual(wishLines('  행복  하자 '), ['행복 하자']);
    assert.deepEqual(wishLines(''), []);
    assert.deepEqual(wishLines('   '), []);
  });
  it('breaks a long Korean line at the space nearest the middle', () => {
    const lines = wishLines('올해는 꼭 좋은 사람 만나게 해 주세요');
    assert.equal(lines.length, 2);
    assert.equal(lines.join(' '), '올해는 꼭 좋은 사람 만나게 해 주세요');
    assert.ok(Math.abs(cps(lines[0]) - cps(lines[1])) <= 6, lines.join('|'));
  });
  it('splits a long single word by code points into two non-empty halves', () => {
    const w = '가나다라마바사아자차카타파하가나다라마바';
    const lines = wishLines(w);
    assert.equal(lines.length, 2);
    assert.equal(lines.join(''), w);
    assert.equal(cps(lines[0]), 10);
  });
  it('never splits a surrogate pair or a ZWJ / flag / keycap / skin-tone sequence', () => {
    const fam = '👨‍👩‍👧‍👦', flag = '🇰🇷', key = '1️⃣', wave = '👋🏽';
    assert.deepEqual(wishGlyphs(fam + flag + key + wave + '가'), [fam, flag, key, wave, '가']);
    assert.deepEqual(wishGlyphs('🇰🇷🇺🇸'), ['🇰🇷', '🇺🇸']);
    const s = '😀😀😀😀😀😀' + fam + '😀😀😀😀😀😀😀';
    for (const line of wishLines(s)) {
      assert.ok(!/[\uD800-\uDBFF]$/.test(line) && !/^[\uDC00-\uDFFF]/.test(line), 'lone surrogate in ' + line);
      assert.ok(!line.endsWith('‍') && !line.startsWith('‍'));
    }
    assert.equal(wishLines(s).join(''), s);
    assert.ok(wishLines(s).some((l) => l.includes(fam)));
  });
  it('takes 24 code points, never more than two lines, no empty second line', () => {
    const cases = ['가'.repeat(24), 'a '.repeat(12), '가 '.repeat(30), '나'.repeat(23) + ' ', ' 다' + '라'.repeat(22), 'x'.repeat(13), '가나다라마바사아자차카타 ', '😀'.repeat(24)];
    for (const c of cases) {
      const lines = wishLines(c);
      assert.ok(lines.length >= 1 && lines.length <= 2, c);
      for (const l of lines) assert.ok(l.length > 0 && l === l.trim(), JSON.stringify(lines));
      assert.ok(cps(lines.join('')) <= 24, c);
    }
    assert.equal(cps(wishLines('가'.repeat(40)).join('')), 24);
  });
  it('drops bidi-override characters, and a newline or tab between words stays a space', () => {
    assert.deepEqual(wishLines('안녕‮하세요'), ['안녕하세요']);
    assert.deepEqual(wishLines('행복\n하자'), ['행복 하자']);
    assert.deepEqual(wishLines('행복\t\r\n하자\u0007'), ['행복 하자']);
    assert.deepEqual(cleanWishes([{ id: 'a', nick: '민\n지', txt: '좋은\n하루' }])[0], { id: 'a', nick: '민 지', txt: '좋은 하루', hearts: 0 });
  });
  it('caps the input before splitting it into glyphs', () => {
    const big = '가'.repeat(1e6);
    const t = process.hrtime.bigint();
    for (let i = 0; i < 50; i++) assert.equal(cps(wishLines(big).join('')), 24);
    assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 200, 'wishLines must not walk a million characters');
  });
});

describe('rotation schedule', () => {
  const t0 = Date.UTC(2026, 10, 20, 3, 0, 0);
  it('is deterministic for a slot and a time', () => {
    for (const id of ['MAIN_UP', 'STREET_7', 'PLOT_18']) assert.equal(wishStep(wishOrd(id), t0, WISH_CYCLE), wishStep(wishOrd(id), t0, WISH_CYCLE));
    assert.equal(wishOrd('STREET_7'), wishOrd('STREET_7'));
    assert.equal(new Set(SLOT_IDS.map(wishOrd)).size, 81);
  });
  it('spends the wish share of each cycle in the wish phase (even steps)', () => {
    for (const cyc of [WISH_CYCLE, WISH_CYCLE_LOW]) {
      const P = cyc.wish + cyc.rest;
      for (const id of ['MAIN_TOP', 'SUB_2B', 'STREET_30']) {
        let on = 0, changes = 0, prev = null;
        for (let t = t0; t < t0 + P * 10; t += 100) {
          const s = wishStep(wishOrd(id), t, cyc);
          if (s % 2 === 0) on++;
          if (prev !== null && s !== prev) { changes++; assert.equal(s, prev + 1); }
          prev = s;
        }
        assert.ok(Math.abs(on / (P * 10 / 100) - cyc.wish / P) < 0.01, id);
        assert.ok(changes >= 19 && changes <= 20, id + ' changes ' + changes);
      }
    }
  });
  it('staggers neighbouring slots: their flips are at least 2 s apart', () => {
    for (const cyc of [WISH_CYCLE, WISH_CYCLE_LOW]) {
      const P = cyc.wish + cyc.rest;
      const flips = (o) => { const out = []; let prev = wishStep(o, t0, cyc); for (let t = t0; t < t0 + P * 3; t += 50) { const s = wishStep(o, t, cyc); if (s !== prev) out.push(t); prev = s; } return out; };
      for (let i = 0; i + 1 < SLOT_IDS.length; i++) {
        const a = flips(wishOrd(SLOT_IDS[i])), b = flips(wishOrd(SLOT_IDS[i + 1]));
        for (const x of a) for (const y of b) assert.ok(Math.abs(x - y) >= 2000, SLOT_IDS[i] + ' ' + (x - y));
      }
    }
  });
  // Only boards that are in the wish phase at that moment count.
  const shown = (cyc, t, n) => SLOT_IDS.map((id) => { const o = wishOrd(id), s = wishStep(o, t, cyc); return s % 2 === 0 ? wishIndex(o, s, n) : null; });
  it('adjacent slots never show the same wish at the same moment, for every list size 2..24', () => {
    for (const cyc of [WISH_CYCLE, WISH_CYCLE_LOW]) {
      const P = cyc.wish + cyc.rest;
      for (let n = 2; n <= 24; n++) {
        for (let t = t0; t < t0 + P * 60; t += 173) {
          const on = shown(cyc, t, n);
          for (let i = 0; i + 1 < on.length; i++) if (on[i] !== null && on[i + 1] !== null) assert.notEqual(on[i], on[i + 1], `n=${n} ${SLOT_IDS[i]} t=${t - t0}`);
        }
      }
    }
  });
  it('every wish of an N-item list (N <= 24) is on some board within one full cycle', () => {
    for (const cyc of [WISH_CYCLE, WISH_CYCLE_LOW]) {
      const P = cyc.wish + cyc.rest;
      for (let n = 1; n <= 24; n++) {
        for (let t = t0; t < t0 + P * 12; t += 311) {
          const hit = new Set();
          for (let u = t; u <= t + P; u += 100) for (const v of shown(cyc, u, n)) if (v !== null) hit.add(v);
          assert.equal(hit.size, n, `n=${n} t=${t - t0}`);
        }
      }
    }
    assert.equal(wishIndex(3, 10, 0), -1);
  });
});

describe('repaint scheduler', () => {
  it('classifies work: a drop is its own kind (never budgeted), the notice phase with nothing shown is free', () => {
    assert.equal(wishWork(true, false, -1, 4), 'drop');
    assert.equal(wishWork(false, false, -1, 4), 'reset');
    assert.equal(wishWork(true, true, 8, 8), 'none');
    assert.equal(wishWork(false, true, 9, 8), 'quiet');
    assert.equal(wishWork(true, true, 9, 8), 'due');
    assert.equal(wishWork(false, true, 10, 9), 'due');
    assert.equal(wishWork(true, true, 10, NaN), 'due');
    // Nothing painted yet: only a near board starts mid-phase; a far one waits for its own next wish phase.
    assert.equal(wishWork(false, true, 10, -1, true), 'due');
    assert.equal(wishWork(false, true, 10, -1, false), 'quiet');
    assert.equal(wishWork(false, true, 12, 11, false), 'due');
  });
  it('pins a wish on the nearest boards that may rotate, at most 4, idempotently', () => {
    const now = 1000;
    const c = (ok, pinId = null, pinUntil = 0) => ({ ok, pinId, pinUntil });
    const cands = [c(false), c(true), c(true), c(false), c(true), c(true), c(true), c(true)];
    assert.deepEqual(wishPinPick(cands, 'w1', now), { covered: 4, paint: [1, 2, 4, 5] });
    // Already pinned to w1 and not expired: counted, not repainted.
    const again = [c(false), c(true, 'w1', 9000), c(true, 'w1', 9000), c(false), c(true, 'w1', 9000), c(true, 'w1', 9000), c(true)];
    assert.deepEqual(wishPinPick(again, 'w1', now), { covered: 4, paint: [] });
    // Expired pin, or pinned to another wish: repainted.
    assert.deepEqual(wishPinPick([c(true, 'w1', 999), c(true, 'w2', 9000)], 'w1', now), { covered: 2, paint: [0, 1] });
    assert.deepEqual(wishPinPick([c(false), c(false)], 'w1', now), { covered: 0, paint: [] });
    assert.deepEqual(wishPinPick([], 'w1', now), { covered: 0, paint: [] });
    const list = cleanWishes([{ id: 'w1', nick: 'a', txt: '합격' }, { id: 7, nick: 'b', txt: '여행' }]);
    assert.equal(wishPinPlan(list, 'nope', cands, now), null);
    assert.equal(wishPinPlan([], 'w1', cands, now), null);
    assert.equal(wishPinPlan(list, 7, cands, now).wish.id, '7');
    assert.deepEqual(wishPinPlan(list, 'w1', again, now).paint, []);
  });
  it('serves nearest first but the longest-waiting board is never skipped for long', () => {
    const since = [5000, 1000, 4000, 4000], rank = [0, 30, 40, 1], out = [];
    assert.equal(wishPick(since, rank, 4, 2, out), 2);
    assert.deepEqual(out.slice(0, 2), [1, 3]);
    assert.equal(wishPick(since, rank, 1, 6, out), 1);
    assert.equal(wishPick(since, rank, 0, 6, out), 0);
  });
  // Drives the same pure functions screens.js runs: wishRelist on every list change, wishPlan on every tick.
  // 81 mounted idle boards, nearest-first order = slot order (camera parked: the worst case for nearest-first).
  // canvas[i] is what board i last painted (screens.js paint(): a marked board paints the notice).
  function harness(cyc, budget) {
    const states = SLOT_IDS.map((id) => ({ wish: null, wishKey: -1, wishPin: 0, wishDue: 0, wishDrop: false, wishFontOk: false, wishOrd: wishOrd(id) }));
    const n = states.length, oks = new Array(n), out = [], served = new Array(n).fill(0), canvas = new Array(n).fill(null);
    const cfg = { list: [], now: 0, cyc, budget, drops: WISH_DROPS, since: new Array(96), rank: new Array(96), who: new Array(96), pick: [], delta: 0 };
    const h = { states, canvas, served, maxLag: 0, maxTick: 0, maxCall: 0, shown: 0 };
    const paintAll = (k) => { for (let j = 0; j < k; j++) { const s = states[out[j]]; canvas[out[j]] = s.wishDrop ? null : s.wish; } };
    h.relist = (list) => {
      const byId = new Map(list.map((w) => [w.id, w])), res = { delta: 0 };
      const k = wishRelist(states, n, byId, WISH_NOW, res, out);
      paintAll(k);
      h.maxCall = Math.max(h.maxCall, k);
      h.shown += res.delta;
      cfg.list = list;
    };
    h.tick = (now) => {
      cfg.now = now;
      for (let i = 0; i < n; i++) oks[i] = cfg.list.length > 0;
      const before = states.map((s) => s.wishDue);
      const k = wishPlan(states, oks, n, cfg, out);
      paintAll(k);
      h.shown += cfg.delta;
      h.maxTick = Math.max(h.maxTick, k);
      for (let j = 0; j < k; j++) { served[out[j]]++; if (before[out[j]]) h.maxLag = Math.max(h.maxLag, now - before[out[j]]); }
      for (const s of states) if (s.wishDue) h.maxLag = Math.max(h.maxLag, now - s.wishDue);
      assert.equal(h.shown, states.filter((s) => s.wish).length, 'card counter drifted');
    };
    return h;
  }
  function simulate(cyc, budget, minutes) {
    const h = harness(cyc, budget), list = Array.from({ length: 24 }, (_, i) => ({ id: 'w' + i, nick: 'n', txt: 't' + i, hearts: 0 }));
    let t = Date.UTC(2026, 10, 20, 3), wasOff = null, offAt = 0;
    const end = t + minutes * 60000;
    for (; t < end; t += WISH_TICK_MS) {
      const off = Math.floor((t / 60000) % 7) === 3;
      if (off !== wasOff) { h.relist(off ? [] : list); wasOff = off; offAt = t; }
      h.tick(t);
      // An emptied list clears every card within ceil((81 - WISH_NOW) / WISH_DROPS) ticks.
      if (off && t - offAt >= Math.ceil((81 - WISH_NOW) / WISH_DROPS) * WISH_TICK_MS) assert.equal(h.shown, 0, 'a card survived an empty list');
    }
    return { maxLag: h.maxLag, maxPer: h.maxTick, maxCall: h.maxCall, minServed: Math.min(...h.served) };
  }
  // Run with a small list until ~40 boards show the same wish, then replace the list; count paints per call and per tick.
  function churn(cyc, budget, before, after) {
    const h = harness(cyc, budget);
    let t = Date.UTC(2026, 10, 20, 3);
    h.relist(before);
    for (const end = t + 120000; t < end; t += WISH_TICK_MS) h.tick(t);
    const gone = before[0];
    const had = h.states.filter((s) => s.wish === gone).length;
    h.maxTick = 0;
    h.relist(after);
    const stale = (i) => h.canvas[i] && h.canvas[i].id === gone.id && h.canvas[i].txt === gone.txt;
    const markedAt = h.canvas.map((_, i) => stale(i));
    let clearedIn = -1;
    for (let k = 1; k <= 40; k++, t += WISH_TICK_MS) {
      h.tick(t);
      // A board never gets repainted with the removed or pre-edit wish after the list changed.
      h.canvas.forEach((c, i) => { if (!markedAt[i]) assert.ok(!stale(i), 'repainted with the old wish'); });
      if (clearedIn < 0 && !h.canvas.some((_, i) => stale(i))) clearedIn = k;
      h.canvas.forEach((_, i) => { if (!stale(i)) markedAt[i] = false; });
    }
    return { had, clearedIn, maxTick: h.maxTick, maxCall: h.maxCall, h };
  }
  it('the list going empty: at most WISH_NOW repaints in the call, budget + WISH_DROPS per tick, all cleared in time', () => {
    for (const [cyc, budget] of [[WISH_CYCLE, WISH_BUDGET], [WISH_CYCLE_LOW, WISH_BUDGET_LOW]]) {
      const only = { id: 'w', nick: 'n', txt: '하나뿐', hearts: 0 };
      const r = churn(cyc, budget, [only], []);
      assert.ok(r.had >= 30, `only ${r.had} boards had it`);
      assert.ok(r.maxCall <= WISH_NOW, `call ${r.maxCall}`);
      assert.ok(r.maxTick <= budget + WISH_DROPS, `tick ${r.maxTick}`);
      assert.ok(r.clearedIn >= 1 && r.clearedIn <= Math.ceil((r.had - WISH_NOW) / WISH_DROPS) + 1, `cleared in ${r.clearedIn} ticks`);
      assert.equal(r.h.shown, 0);
    }
  });
  it('the only wish edited: the near boards get the new text at once, the rest never repaint the old one', () => {
    for (const [cyc, budget] of [[WISH_CYCLE, WISH_BUDGET], [WISH_CYCLE_LOW, WISH_BUDGET_LOW]]) {
      const a = { id: 'w', nick: 'n', txt: '처음 글', hearts: 0 }, b = { ...a, txt: '고친 글' };
      const r = churn(cyc, budget, [a], [b]);
      assert.ok(r.maxCall <= WISH_NOW && r.maxTick <= budget + WISH_DROPS, `${r.maxCall} ${r.maxTick}`);
      assert.ok(r.clearedIn >= 1 && r.clearedIn <= Math.ceil((r.had - WISH_NOW) / WISH_DROPS) + 1, `cleared in ${r.clearedIn} ticks`);
      assert.ok(r.h.states.some((s) => s.wish === b));
    }
  });
  it('a loaded font repaints at most the nearest WISH_NOW boards showing exactly that wish, once', () => {
    const w = { id: 'w', nick: 'n', txt: 't' }, other = { id: 'x', nick: 'n', txt: 't' };
    const st = Array.from({ length: 30 }, (_, i) => ({ wish: i % 3 === 2 ? other : { ...w }, wishDrop: i === 4, wishFontOk: i === 3 }));
    const out = [];
    const k = wishFontTargets(st, st.length, w, WISH_NOW, out);
    assert.deepEqual(out.slice(0, k), [0, 1, 6, 7, 9]);
    assert.equal(wishFontTargets(st, st.length, { ...w, txt: 'edited' }, WISH_NOW, out), 0);
  });
  it('supply covers demand on each tier', () => {
    const per = (cyc) => SLOT_IDS.length * 2 / (cyc.wish + cyc.rest) * WISH_TICK_MS;
    assert.ok(WISH_BUDGET >= per(WISH_CYCLE) * 1.05, String(per(WISH_CYCLE)));
    assert.ok(WISH_BUDGET_LOW >= per(WISH_CYCLE_LOW) * 1.05, String(per(WISH_CYCLE_LOW)));
  });
  it('no board starves over 10 simulated minutes; every flip is painted within one tick', () => {
    for (const [cyc, budget, bound] of [[WISH_CYCLE, WISH_BUDGET, WISH_TICK_MS], [WISH_CYCLE_LOW, WISH_BUDGET_LOW, WISH_TICK_MS]]) {
      const r = simulate(cyc, budget, 10);
      assert.ok(r.maxLag <= bound, `lag ${r.maxLag}`);
      assert.ok(r.maxCall <= WISH_NOW, `call ${r.maxCall}`);
      const expect = 10 * 60000 * (6 / 7) * 2 / (cyc.wish + cyc.rest); // one minute in seven the list is empty
      assert.ok(r.minServed >= expect * 0.8, `served ${r.minServed} of ~${expect}`);
      assert.ok(r.maxPer <= budget + WISH_DROPS, `tick ${r.maxPer}`);
    }
  });
});

describe('which boards rotate', () => {
  it('compares numbers for held boards: rowUntil parses once, wishRotates takes now and the parsed time', () => {
    const now = Date.UTC(2026, 10, 20, 3);
    assert.equal(rowUntil({ lit_until: new Date(now + 1000).toISOString() }), now + 1000);
    assert.equal(rowUntil({ expires_at: new Date(now - 5).toISOString() }), now - 5);
    assert.equal(rowUntil({ lit_until: 'garbage' }), 0);
    assert.equal(rowUntil(undefined), 0);
    const held = { holder_id: 'u1' };
    assert.equal(wishRotates('SUB_1A', held, false, false, now, now + 1), false);
    assert.equal(wishRotates('SUB_1A', held, false, false, now, now), true);
    assert.equal(wishRotates('SUB_1A', held, false, false, now, 0), true);
  });
  it('vacant, dark and closed main tower yes; live, open main tower, photos and air show no', () => {
    assert.equal(wishRotates('STREET_3', undefined, false, false), true);
    assert.equal(wishRotates('STREET_3', { holder_id: null }, false, false), true);
    assert.equal(wishRotates('SUB_1A', { holder_id: 'u1', lit_until: past }, false, false), true);
    assert.equal(wishRotates('SUB_1A', { holder_id: 'u1', lit_until: future }, false, false), false);
    assert.equal(wishRotates('MAIN_TOP', { holder_id: null }, false, false), true);
    assert.equal(wishRotates('MAIN_TOP', { holder_id: null }, false, true), false);
    assert.equal(wishRotates('PLOT_4', { holder_id: 'u1', lit_until: past, photo_status: 'pending' }, false, false), false);
    assert.equal(wishRotates('PLOT_4', { holder_id: 'u1', lit_until: past, photo_status: 'approved' }, false, false), false);
    assert.equal(wishRotates('PLOT_4', { holder_id: 'u1', lit_until: past, photo_status: 'rejected' }, false, false), true);
    assert.equal(wishRotates('STREET_3', undefined, true, false), false);
    assert.equal(wishRotates('WALL_1', undefined, false, false), false);
    assert.equal(wishRotates('MAIN_S', undefined, false, false), false);
  });
  it('keeps the claim cue in the bottom strip', () => {
    assert.equal(wishStrip('STREET_1', undefined, false), '빈 자리 · 200포인트부터');
    assert.equal(wishStrip('SUB_1A', { holder_id: null }, false), '빈 자리 · 800포인트부터');
    assert.equal(wishStrip('SUB_1A', { holder_id: 'u1', lit_until: past }, false), '불 꺼짐 · 주인이 다시 켤 수 있어요');
    assert.equal(wishStrip('MAIN_UP', undefined, false), '밤 9시에 10분만 열려요 · 4,000포인트부터');
  });
});

describe('setWishes input', () => {
  const raw = [{ id: 'a', nick: '민지', txt: '합격!', hearts: 3 }, { id: 'b', nick: '', txt: '  여행  가자 ', hearts: '2' }, { id: 'c', nick: 'x', txt: '   ', hearts: 1 }, { id: 'a', nick: 'dup', txt: 'dup', hearts: 9 }, null, { nick: 'no id', txt: 'x' }];
  it('cleans, dedupes and caps the list', () => {
    const w = cleanWishes(raw);
    assert.deepEqual(w, [{ id: 'a', nick: '민지', txt: '합격!', hearts: 3 }, { id: 'b', nick: '누군가', txt: '여행 가자', hearts: 2 }]);
    assert.equal(cleanWishes(Array.from({ length: 40 }, (_, i) => ({ id: 'w' + i, nick: 'n', txt: 't', hearts: 0 }))).length, 24);
    assert.deepEqual(cleanWishes(undefined), []);
    assert.deepEqual(cleanWishes('nope'), []);
  });
  it('detects an unchanged list as a no-op, and a change of id, text or hearts as work', () => {
    const a = cleanWishes(raw);
    assert.equal(sameWishes(a, cleanWishes(raw)), true);
    assert.equal(sameWishes([], cleanWishes([])), true);
    assert.equal(sameWishes(a, cleanWishes([raw[0]])), false);
    assert.equal(sameWishes(a, cleanWishes([{ ...raw[0], hearts: 4 }, raw[1]])), false);
    assert.equal(sameWishes(a, cleanWishes([{ ...raw[0], txt: '합격!!' }, raw[1]])), false);
    assert.equal(sameWishes(a, cleanWishes([raw[1], raw[0]])), false);
  });
});

describe('fresh-wish pin', () => {
  it('no pin from the initial load, a pin for a genuinely new wish later', () => {
    const seen = new Set(['a', 'b']);
    const list = [{ id: 'a' }, { id: 'c' }, { id: 'd' }];
    assert.equal(freshWish(seen, list, false), null);
    assert.equal(freshWish(seen, list, true).id, 'c');
    assert.equal(freshWish(new Set(['a', 'c', 'd']), list, true), null);
    // [] then the first real list two seconds later: still the initial load.
    assert.equal(wishSettled(1000, false, 3000), false);
    // [] and nothing for a while, then this player's wish (first of the day): settled, so it pins.
    assert.equal(wishSettled(1000, false, 1000 + WISH_SETTLE_MS), true);
    // A non-empty list was already seen: settled.
    assert.equal(wishSettled(1000, true, 1001), true);
    // Never got an array: not settled.
    assert.equal(wishSettled(0, false, 1e12), false);
  });
});

describe('wiring', () => {
  const screens = readFileSync(new URL('../ts3d/screens.js', import.meta.url), 'utf8');
  const world = readFileSync(new URL('../timesSquare3d.js', import.meta.url), 'utf8');
  it('exposes setWishes on the scene api and keeps one screens.js module', () => {
    assert.match(world, /setWishes\(list\) \{ boards\.setWishes\(list\); \}/);
    assert.match(world, /pinWish\(id\) \{ return boards\.pinWish\(id\); \}/);
    assert.match(screens, /setWishes, pinWish,/);
  });
  it('screens.js runs the tested loop, relist and font targeting, and pins only mounted boards', () => {
    assert.match(screens, /wishPlan\(nearB, nearOk, count, planCfg, planOut\)/);
    assert.match(screens, /wishRelist\(nearB, count, byId, WISH_NOW, relistRes, planOut\)/);
    assert.match(screens, /wishFontTargets\(nearB, count, w, WISH_NOW, planOut\)/);
    assert.match(screens, /ok: b\.mounts\.length > 0 && !b\.shared/);
    assert.equal(/function wishTick[\s\S]*?wishWork\(/.test(screens.slice(screens.indexOf('function wishTick'), screens.indexOf('function pinOn'))), false);
    // one module, one URL: the scene and the dressing must load screens.js (and screens.js must load art.js) under the same address
    const q = (src, re) => (src.match(re) || [])[1];
    const fromWorld = q(world, /from '\.\/ts3d\/screens\.js(\?v=[0-9a-z]+)'/);
    assert.ok(fromWorld);
    assert.equal(q(readFileSync(new URL('../ts3d/timesq.js', import.meta.url), 'utf8'), /from '\.\/screens\.js(\?v=[0-9a-z]+)'/), fromWorld);
    assert.equal(q(screens, /from '\.\/art\.js(\?v=[0-9a-z]+)'/), fromWorld);
  });
  it('only paints wish text through the canvas', () => {
    assert.equal(/innerHTML|insertAdjacentHTML/.test(screens), false);
  });
});
