// Package nine: the 9 pm countdown and wish-king minute (live.js rules, ts3d/screens.js setKing budget) and inbox unread handling.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { NINE, kstMsOfDay, ninePhase, nineLeft, nineBanner, kingMinute, clockSkew, mmss, nineSlot } from '../live.js';
import { serverRead, liveOnly, handledRead, liveSeeable } from '../inbox.js';
import { ballOpen } from '../balance.js';

register(new URL('./nine-three-hook.mjs', import.meta.url));

// 2026-11-21 KST hh:mm:ss.ms as an epoch.
const kst = (h, m, s = 0, ms = 0) => Date.UTC(2026, 10, 21, h - 9, m, s, ms);

describe('밤 9시 clock rules', () => {
  it('phases at the edges', () => {
    assert.equal(ninePhase(kst(20, 49, 59, 999)), '');
    assert.equal(ninePhase(kst(20, 50)), 'pre');
    assert.equal(ninePhase(kst(20, 59, 59, 999)), 'pre');
    assert.equal(ninePhase(kst(21, 0)), 'open');
    assert.equal(ninePhase(kst(21, 9, 59, 999)), 'open');
    assert.equal(ninePhase(kst(21, 10)), '');
    assert.equal(ninePhase(kst(9, 0)), '');
    assert.equal(kstMsOfDay(kst(0, 0)), 0);
    assert.equal(kstMsOfDay(kst(21, 0)), NINE.open);
  });
  it('the open phase matches the server window (balance.js ballOpen) second by second at both edges', () => {
    for (const t of [kst(20, 59, 59), kst(21, 0), kst(21, 0, 1), kst(21, 9, 59), kst(21, 10), kst(21, 10, 1)]) {
      assert.equal(ninePhase(t) === 'open', ballOpen(t), new Date(t).toISOString());
    }
  });
  it('banner text and countdown, never 00:00 inside a phase', () => {
    assert.equal(nineBanner(kst(20, 49, 59)), null);
    assert.deepEqual(nineBanner(kst(20, 50)), { phase: 'pre', left: 600000, text: '밤 9시, 메인 타워가 열려요 · 10:00' });
    assert.equal(nineBanner(kst(20, 58, 30, 400)).text, '밤 9시, 메인 타워가 열려요 · 01:30');
    assert.equal(nineBanner(kst(20, 59, 59, 999)).text, '밤 9시, 메인 타워가 열려요 · 00:01');
    assert.equal(nineBanner(kst(21, 0)).text, '지금 메인 타워가 열렸어요 · 닫히기까지 10:00');
    assert.equal(nineBanner(kst(21, 9, 59, 1)).text, '지금 메인 타워가 열렸어요 · 닫히기까지 00:01');
    assert.equal(nineBanner(kst(21, 10)), null);
    assert.equal(nineLeft(kst(12, 0)), 0);
    assert.equal(mmss(0), '00:00');
    assert.equal(mmss(61000), '01:01');
  });
  it('the king minute is 21:00:00–21:00:59 and needs a king', () => {
    const king = { nick: '하늘', txt: '합격하게 해 주세요', hearts: 9 };
    assert.equal(kingMinute(kst(20, 59, 59, 999), king), false);
    assert.equal(kingMinute(kst(21, 0), king), true);
    assert.equal(kingMinute(kst(21, 0, 59, 999), king), true);
    assert.equal(kingMinute(kst(21, 1), king), false);
    assert.equal(kingMinute(kst(21, 0, 30), null), false);
    assert.equal(kingMinute(kst(21, 0, 30), { nick: 'x', txt: '' }), false);
  });
  it('a client clock a few seconds off is corrected by the Date header offset', () => {
    // The server is at 21:00:00.2; this client reads 20:59:55.2 (5 s slow). The request took 200 ms.
    const server = kst(21, 0, 0, 200), local = server - 5000;
    const off = clockSkew(new Date(Math.floor(server / 1000) * 1000).toUTCString(), local - 100, local + 100);
    assert.ok(Math.abs(off - 5000) <= 500, String(off));
    assert.equal(ninePhase(local), 'pre');
    assert.equal(ninePhase(local + off), 'open');
    assert.equal(kingMinute(local + off, { txt: 'a' }), true);
    // 7 s fast near the close.
    const s2 = kst(21, 9, 58, 0), l2 = s2 + 7000;
    const off2 = clockSkew(new Date(s2).toUTCString(), l2 - 50, l2 + 50);
    assert.ok(Math.abs(off2 + 7000) <= 600, String(off2));
    assert.equal(ninePhase(l2), '');
    assert.equal(ninePhase(l2 + off2), 'open');
  });
  it('clock offset ignores noise, a missing header and nonsense', () => {
    const now = kst(15, 0);
    assert.equal(clockSkew(new Date(now).toUTCString(), now - 300, now + 300), 0);
    assert.equal(clockSkew(null, now, now), 0);
    assert.equal(clockSkew('not a date', now, now), 0);
    assert.equal(clockSkew(new Date(now + 2 * 864e5).toUTCString(), now, now), 0);
    // A slow round trip: the header could be anywhere inside it, so no offset (40 s boot fetch on a correct clock).
    assert.equal(clockSkew(new Date(now + 18000).toUTCString(), now - 1000, now + 39000), 0);
    assert.ok(clockSkew(new Date(now + 20000).toUTCString(), now - 1000, now + 1000) > 19000);
  });
  it('the banner opens the cheapest main tower slot nobody keeps lit', () => {
    const now = kst(21, 2), lit = new Date(now + 36e5).toISOString(), dark = new Date(now - 36e5).toISOString();
    assert.equal(nineSlot([], now), 'MAIN_LOW');
    assert.equal(nineSlot([{ slot_id: 'MAIN_LOW', holder_id: 'g', lit_until: lit }], now), 'MAIN_BOT');
    assert.equal(nineSlot([{ slot_id: 'MAIN_LOW', holder_id: 'g', lit_until: dark }], now), 'MAIN_LOW');
    const all = ['MAIN_LOW', 'MAIN_BOT', 'MAIN_MID', 'MAIN_TOP', 'MAIN_UP'].map((slot_id) => ({ slot_id, holder_id: 'g', expires_at: lit }));
    assert.equal(nineSlot(all, now), 'MAIN_LOW');
  });
});

// ---- ts3d/screens.js with the real three and a recording 2D context --------------------------------------------------
function fakeDom() {
  const log = { paints: 0 };
  const ctx = () => {
    const words = [];
    const g = new Proxy({ words }, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
        if (k === 'clearRect') return () => { words.length = 0; log.paints++; };
        if (k === 'fillText') return (s) => { words.push(String(s)); };
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => {};
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    return g;
  };
  globalThis.document = { createElement: () => { let g = null; return { width: 0, height: 0, getContext() { return g || (g = ctx()); } }; } };
  return log;
}

async function boardsFor(quality) {
  const log = fakeDom();
  const { createBoards } = await import('../ts3d/screens.js');
  const THREE = await import('three');
  const renderer = { capabilities: { getMaxAnisotropy: () => 4 } };
  const boards = createBoards({ renderer, kitMats: {}, pick: [], quality });
  const parent = new THREE.Group();
  const ids = ['MAIN_TOP', 'MAIN_MID', 'SUB_1A', 'SUB_1B', ...Array.from({ length: 30 }, (_, i) => 'STREET_' + (i + 1)), ...Array.from({ length: 18 }, (_, i) => 'PLOT_' + (i + 1))];
  ids.forEach((id, i) => boards.mount(id, parent, { x: i * 10, y: 5, z: 0, w: 16, h: 9 }));
  const cam = new THREE.Vector3(0, 5, 20);
  return { boards, log, ids, cam, words: (id) => boards.get(id).canvas.getContext('2d').words.join(' ') };
}
const KING = { nick: '소원왕님', txt: '우리 가족 건강하게', hearts: 12 };

describe('wish king minute on the boards', () => {
  it('enters and leaves on a per-tick budget, nearest first, never the main tower', async () => {
    for (const [quality, per] of [['low', 1], ['high', 3]]) {
      const { boards, log, ids, cam, words } = await boardsFor(quality);
      boards.update(1, cam);
      boards.set('STREET_2', { holder_id: 'guest:a', holder_name: '주인', line1: '내 가게', line2: '', line3: '', lit_until: new Date(Date.now() + 36e5).toISOString() });
      const before = words('STREET_2');
      assert.match(before, /내 가게/);
      log.paints = 0;
      assert.equal(boards.setKing(KING), true);
      assert.equal(log.paints, 0, 'setKing paints nothing by itself');
      assert.equal(boards.setKing({ ...KING }), false, 'same card again is no work');
      const want = ids.filter((id) => !id.startsWith('MAIN_')).length;
      let ticks = 0;
      while (ids.filter((id) => boards.get(id).kingOn).length < want && ticks < 200) {
        log.paints = 0;
        boards.update(0.1, cam);
        ticks++;
        const shown = ids.filter((id) => boards.get(id).kingOn).length;
        assert.ok(shown <= ticks * per, `${quality}: ${shown} boards after ${ticks} ticks`);
      }
      assert.equal(ids.filter((id) => boards.get(id).kingOn).length, want, quality);
      assert.ok(ticks >= Math.ceil(want / per), `${quality} took ${ticks} ticks`);
      assert.equal(boards.get('SUB_1A').kingOn > 0, true);
      assert.equal(!!boards.get('MAIN_TOP').kingOn, false);
      assert.equal(!!boards.get('MAIN_MID').kingOn, false);
      assert.match(words('STREET_2'), /우리 가족 건강하게/);
      assert.match(words('STREET_2'), /어제의 소원왕/);
      // Leave: back to exactly the holder's ad, on the same budget. A board still waiting its turn keeps the king's name
      // on its moving strip.
      boards.setKing(null);
      boards.update(0.1, cam);
      const waiting = ids.filter((id) => boards.get(id).kingOn);
      assert.ok(waiting.length > 0);
      assert.equal(boards.get(waiting[0]).kingNick, '소원왕님');
      let out = 1;
      while (ids.some((id) => boards.get(id).kingOn) && out < 200) { boards.update(0.1, cam); out++; }
      assert.ok(out >= Math.ceil(want / per), `${quality} left in ${out} ticks`);
      // The near boards' moving strip writes after the artwork, so compare the artwork part.
      assert.equal(words('STREET_2').startsWith(before), true);
      assert.doesNotMatch(words('STREET_2'), /소원왕|건강하게/);
    }
  });
  it('a live takeover wins over the king and the king comes back after it', async () => {
    const { boards, ids, cam, words } = await boardsFor('high');
    boards.update(1, cam);
    boards.setKing(KING);
    for (let i = 0; i < 40; i++) boards.update(0.1, cam);
    boards.setAir({ nick: '광고주', line: '전 전광판 장악 중', until: Date.now() + 60000 });
    assert.match(words('STREET_5'), /전 전광판 장악/);
    assert.equal(!!boards.get('STREET_5').kingOn, false);
    boards.setAir(null);
    assert.match(words('STREET_5'), /우리 가족 건강하게/);
    assert.ok(ids.filter((id) => !id.startsWith('MAIN_')).every((id) => boards.get(id).kingOn));
  });
  it('wish cards give way without a burst while the minute starts', async () => {
    const { boards, log, cam } = await boardsFor('low');
    boards.update(1, cam);
    boards.setWishes([{ id: 'aaaaaaaaaa', nick: 'a', txt: '첫 소원', hearts: 1 }, { id: 'bbbbbbbbbb', nick: 'b', txt: '둘째 소원', hearts: 0 }]);
    for (let i = 0; i < 400; i++) boards.update(0.1, cam);
    boards.setKing(KING);
    let worst = 0;
    for (let i = 0; i < 120; i++) { log.paints = 0; boards.update(0.08, cam); worst = Math.max(worst, log.paints); }
    // Per tick: the king budget (1 on low) plus the wish rotation budget (4 on low) at most, plus the 10 near boards' live strip.
    assert.ok(worst <= 1 + 4, `worst ${worst} canvas repaints in one tick`);
    assert.equal([...boards.boards.values()].some((b) => b.wish && b.kingOn), false);
  });
});

describe('inbox unread', () => {
  it('reads the server read marker from the unread-first order', () => {
    const at = (h) => new Date(Date.UTC(2026, 10, 20, h)).toISOString();
    assert.deepEqual([...serverRead([{ id: 5, created_at: at(10) }, { id: 4, created_at: at(12) }, { id: 3, created_at: at(9) }])], [4, 3]);
    assert.deepEqual([...serverRead([{ id: 5, created_at: at(12) }, { id: 4, created_at: at(11) }, { id: 3, created_at: at(9) }])], []);
    assert.deepEqual([...serverRead([{ id: 7, created_at: at(12), read_at: at(13) }, { id: 6, created_at: at(11) }])], [7]);
    assert.deepEqual([...serverRead(null)], []);
  });
  it('keeps live news until its stored row comes back', () => {
    const now = Date.UTC(2026, 10, 21, 3);
    const live = [{ kind: 'cheer', slot_id: 'STREET_3', at: now }, { kind: 'taken', slot_id: 'SUB_1A', at: now }];
    const stored = [{ id: 9, kind: 'cheer', slot_id: 'STREET_3', created_at: new Date(now + 30000).toISOString() }];
    assert.deepEqual(liveOnly(live, stored).map((n) => n.slot_id), ['SUB_1A']);
    assert.deepEqual(liveOnly(live, []).length, 2);
    assert.deepEqual(liveOnly(null, stored), []);
  });
  it('only a taken board I hold again is read on the server; seen-live rows stay local', () => {
    const items = [
      { id: 11, kind: 'taken', slot_id: 'STREET_8' },
      { id: 12, kind: 'taken', slot_id: 'STREET_9' },
      { id: 13, kind: 'cheer', slot_id: 'STREET_8' },
    ];
    const holder = (slot) => (slot === 'STREET_8' ? 'guest:me' : 'guest:other');
    assert.deepEqual(handledRead([11, 12, 13], items, holder, 'guest:me'), { server: [11], local: [11, 12, 13] });
    assert.deepEqual(handledRead([11], items, holder, ''), { server: [], local: [11] });
    assert.deepEqual(handledRead([99], items, holder, 'guest:me'), { server: [], local: [99] });
    assert.deepEqual(handledRead(null, items, holder, 'guest:me'), { server: [], local: [] });
  });
  it('a live line counts as seen only outside newcomer mode in a visible tab', () => {
    assert.equal(liveSeeable(false, 'visible'), true);
    assert.equal(liveSeeable(true, 'visible'), false);
    assert.equal(liveSeeable(false, 'hidden'), false);
    assert.equal(liveSeeable(false, undefined), false);
  });
  it('main.js sends read in the background and counts server-read rows as seen', () => {
    const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    assert.equal(main.includes('await readInbox('), false);
    assert.match(main, /seen: seenIds\(\)/);
    assert.equal(main.includes('setRank'), false);
  });
});
