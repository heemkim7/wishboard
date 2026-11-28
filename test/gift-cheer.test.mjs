// 선물 전광판 응원 (the owner's decision, 2026-11-28: "선물 전광판 응원도 미션으로 세줘"): a cheer on another person's gift board shown in the
// plaza counts like a cheer on a lit board (worker.js Room.cheerGift, Room.cheerLand; giftsrv.js giftDb.cheerOf). The real Worker, Meter and
// Room on in-memory SQLite (test/reinforce-harness.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { makeEnv, withClock, harness, KEY } from './reinforce-harness.mjs';
import { PAY } from '../balance.js';
import { kstDay, dayStart } from '../giftrules.js';
import { sendGiftCheer, sendCheer } from '../tribe.js';
import { EVENT_NAMES } from '../plaza-account.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
function net(boards) {
  const orig = globalThis.fetch, origCaches = globalThis.caches;
  globalThis.fetch = async (url) => { const u = String(url);
    if (u.includes('/rest/v1/billboards')) return json(boards.map((b) => ({ ...b })));
    if (u.includes('/rest/v1/')) return json([]);
    return json({ ok: true }); };
  globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return () => { globalThis.fetch = orig; globalThis.caches = origCaches; };
}
const lit = (slot, holder) => ({ slot_id: slot, holder_id: holder, holder_name: '주인', line1: '우리 가게', line2: '', line3: '', lit_until: new Date(Date.now() + 864e5).toISOString(), expires_at: null });
const sock = (room, id) => { const ws = { sent: [], send(s) { this.sent.push(JSON.parse(String(s))); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
  ws.a = { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 1500, y: 1500, fl: 0, name: '손님' } }; room.socks().set(ws, ws.a); return ws; };
const say = async (room, ws, m) => { const n = ws.sent.length; ws.a.ls = Date.now(); room.socks().set(ws, ws.a); await room.webSocketMessage(ws, JSON.stringify(m)); return ws.sent.slice(n).filter((x) => x.t === 'PAY'); };
const cheerB = async (room, ws, slot) => (await say(room, ws, { t: 'CHEER', slot, p: 1 })).find((m) => m.kind === 'cheer');
const cheerG = async (room, ws, g) => (await say(room, ws, { t: 'CHEER', g, p: 2 })).find((m) => m.kind === 'cheer');
const quest = async (room, ws) => (await say(room, ws, { t: 'QUEST', key: 'cheer' })).find((m) => m.kind === 'quest');
// A gift board straight into Meter 'gift' (giftsrv.js gb). o: { id, uid, day, a, b, at, st }. at after a: a "지금" board (no ceremony start),
// so its reveal is 00:00 KST of its day (giftrules.js revealAt).
const ids = (() => { let n = 0; return () => 'gc' + String(++n).padStart(6, '0'); })();
function gift(env, o = {}) {
  const now = Date.now(), id = o.id || ids(), a = o.a ?? now - 36e5, b = o.b ?? a + 6 * 36e5;
  env.meter('gift').do.giftI().exec("insert into gb(id, at, uid, ip, day, a, b, scr, st, j) values(?, ?, ?, ?, ?, ?, ?, 'STREET_31', ?, ?)",
    id, o.at ?? a + 1, o.uid || 'guest:maker', 'f'.repeat(16), o.day || kstDay(a), a, b, o.st || 'live', JSON.stringify({ to: '민지', from: '친구', occ: 'bday', msg: '생일 축하해', th: '' }));
  return id;
}
const T0 = Date.parse('2027-06-10T03:00:00Z'); // 12:00 KST
const factCalls = (env) => env.calls.filter((c) => c === 'gift.giftCheerLive' || c === 'gift.giftCheerOf').length;
const rnd = () => Array.from({ length: 8 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)]).join('');

describe('선물 전광판 응원: the server decides', { concurrency: false }, () => {
  it('a non-maker on a revealed gift board up now: paid like a board cheer, with g on the answer, one counted DO call', async () => {
    await withClock(T0, async () => {
      const restore = net([]);
      try {
        const env = makeEnv(), R = env.room('chapel:square'), fan = sock(R.do, 'guest:fan'), id = gift(env);
        env.calls.length = 0;
        const pay = await cheerG(R.do, fan, id);
        assert.deepEqual(pay, { t: 'PAY', kind: 'cheer', amount: PAY.cheer.base, g: id });
        assert.equal(factCalls(env), 1);
        const coin = R.sql.db.prepare('select delta from coin where uid = ?').get('guest:fan');
        assert.equal(coin.delta, PAY.cheer.base);
      } finally { restore(); }
    });
  });
  it('refused (dark, nothing paid, nothing about the board told): the maker, a board before its reveal, an unknown id, a board not up now, a hidden one', async () => {
    await withClock(T0, async (clock) => {
      const restore = net([]);
      try {
        const env = makeEnv(), R = env.room('chapel:square'), fan = sock(R.do, 'guest:fan'), maker = sock(R.do, 'guest:maker');
        const now = Date.now(), tomorrow = dayStart(kstDay(now + 864e5));
        const mine = gift(env, { uid: 'guest:maker' });
        const early = gift(env, { day: kstDay(tomorrow), a: tomorrow + 10 * 36e5, at: now });
        const over = gift(env, { a: now - 7 * 36e5, b: now - 1000 });
        const later = gift(env, { a: now + 36e5, at: now }); // today, not up yet
        const hidden = gift(env, { st: 'hidden' });
        assert.deepEqual(await cheerG(R.do, maker, mine), { t: 'PAY', kind: 'cheer', amount: 0, why: 'dark', g: mine });
        for (const id of [early, over, later, hidden, 'zz00zz00']) assert.deepEqual(await cheerG(R.do, fan, id), { t: 'PAY', kind: 'cheer', amount: 0, why: 'dark', g: id }, id);
        assert.deepEqual(await say(R.do, fan, { t: 'CHEER', g: 'NOT-AN-ID', p: 1 }), [], 'a malformed id is not answered');
        assert.deepEqual(await say(R.do, fan, { t: 'CHEER', g: mine, p: 13 }), [], 'nor a phrase out of range');
        assert.equal(R.sql.db.prepare("select count(*) n from coin").get().n, 0, 'nothing paid');
        assert.equal(await quest(R.do, fan), undefined, 'nothing counted toward the quest');
        clock.add(PAY.cheer.gapMs);
        // The maker on another account of theirs is someone else: the server only knows the account or guest that made it.
        assert.equal((await cheerG(R.do, fan, mine)).amount, PAY.cheer.base);
      } finally { restore(); }
    });
  });
  it('one daily count with board cheers: 2 board cheers and 1 gift cheer pay the third-cheer QUEST once', async () => {
    await withClock(T0, async (clock) => {
      const restore = net([lit('PLOT_9', 'guest:holder'), lit('PLOT_10', 'guest:holder')]);
      try {
        const env = makeEnv(), R = env.room('chapel:square'), fan = sock(R.do, 'guest:fan'), id = gift(env);
        assert.equal((await cheerB(R.do, fan, 'PLOT_9')).amount, PAY.cheer.base);
        assert.equal((await cheerB(R.do, fan, 'PLOT_10')).amount, PAY.cheer.base);
        assert.equal(await quest(R.do, fan), undefined, 'two cheers are not three');
        assert.equal((await cheerG(R.do, fan, id)).amount, PAY.cheer.base);
        assert.deepEqual(await quest(R.do, fan), { t: 'PAY', kind: 'quest', amount: PAY.quest.cheer, key: 'cheer' });
        clock.add(PAY.cheer.gapMs);
        assert.equal((await cheerG(R.do, fan, id)).amount, PAY.cheer.base);
        assert.equal(await quest(R.do, fan), undefined, 'the quest pays once a day');
      } finally { restore(); }
    });
  });
  it('the same gap per board as a lit board, the same hour cap and day points over both kinds', async () => {
    await withClock(T0, async (clock) => {
      const restore = net([lit('PLOT_9', 'guest:holder')]);
      try {
        const env = makeEnv(), R = env.room('chapel:square'), fan = sock(R.do, 'guest:fan'), g1 = gift(env), g2 = gift(env);
        const sum = await say(R.do, fan, { t: 'CHEER', g: g1, p: 2 });
        assert.equal(sum[0].amount, PAY.cheer.base);
        assert.deepEqual(await cheerG(R.do, fan, g1), { t: 'PAY', kind: 'cheer', amount: 0, why: 'soon', g: g1 }, 'the same board again too soon');
        assert.equal((await cheerG(R.do, fan, g2)).amount, PAY.cheer.base, 'another gift board is another target');
        assert.equal((await cheerB(R.do, fan, 'PLOT_9')).amount, PAY.cheer.base, 'and a lit board is not held back by a gift cheer');
        let n = 3, paid = PAY.cheer.base * 3;
        while (n < PAY.cheer.perHour) { clock.add(PAY.cheer.gapMs); const p = await cheerG(R.do, fan, g1); assert.equal(p.amount, PAY.cheer.base); paid += p.amount; n++; }
        clock.add(PAY.cheer.gapMs);
        assert.deepEqual(await cheerB(R.do, fan, 'PLOT_9'), { t: 'PAY', kind: 'cheer', amount: 0, why: 'cap' }, "this hour's cheers are shared");
        assert.deepEqual(await cheerG(R.do, fan, g2), { t: 'PAY', kind: 'cheer', amount: 0, why: 'cap', g: g2 });
        clock.add(36e5);
        assert.deepEqual(await cheerG(R.do, fan, g2), { t: 'PAY', kind: 'cheer', amount: 0, why: 'full', g: g2 }, "today's paid cheers are shared: it lands without points");
        assert.equal(paid, PAY.cheer.base * PAY.cheer.perDay);
      } finally { restore(); }
    });
  });
  it('the budget guard: hard says wait with no DO call; the facts are kept a minute (five at lean); a failed call says wait and is not retried at once', async () => {
    await withClock(T0, async (clock) => {
      const restore = net([]);
      try {
        const env = makeEnv(), R = env.room('chapel:square'), fan = sock(R.do, 'guest:fan'), id = gift(env), id2 = gift(env);
        R.do.lvl = 2; env.calls.length = 0;
        assert.deepEqual(await cheerG(R.do, fan, id), { t: 'PAY', kind: 'cheer', amount: 0, why: 'wait', g: id });
        assert.equal(factCalls(env), 0);
        R.do.lvl = 0;
        assert.equal((await cheerG(R.do, fan, id)).amount, PAY.cheer.base);
        clock.add(30000);
        assert.equal((await cheerG(R.do, fan, id)).amount, PAY.cheer.base);
        assert.equal(factCalls(env), 1, 'one call for both cheers');
        clock.add(60000);
        await cheerG(R.do, fan, id);
        assert.equal(factCalls(env), 2, 'asked again after a minute');
        R.do.lvl = 1; clock.add(120000);
        await cheerG(R.do, fan, id);
        assert.equal(factCalls(env), 2, 'lean keeps them longer');
        R.do.lvl = 0; clock.add(300000); // the list runs out
        const meter = env.meter('gift').do, real = meter.giftCheerLive;
        meter.giftCheerLive = () => { throw new Error('down'); };
        assert.deepEqual(await cheerG(R.do, fan, id2), { t: 'PAY', kind: 'cheer', amount: 0, why: 'wait', g: id2 });
        clock.add(2000);
        assert.deepEqual(await cheerG(R.do, fan, id2), { t: 'PAY', kind: 'cheer', amount: 0, why: 'wait', g: id2 });
        assert.equal(factCalls(env), 3, 'not asked again during the failure pause');
        meter.giftCheerLive = real; clock.add(10000);
        assert.equal((await cheerG(R.do, fan, id2)).amount, PAY.cheer.base);
      } finally { restore(); }
    });
  });
  it('made-up ids from many sockets cost at most one list read per GF_MISS a room (never one each); a board that went up since counts once the list is that old', async () => {
    await withClock(T0, async (clock) => {
      const restore = net([]);
      try {
        const env = makeEnv(), R = env.room('chapel:square'), socks = [1, 2, 3].map((i) => sock(R.do, 'guest:fan' + i)), id = gift(env);
        env.calls.length = 0;
        assert.equal((await cheerG(R.do, socks[0], id)).amount, PAY.cheer.base);
        let dark = 0;
        for (let i = 0; i < 900; i++) { // 90 s, 30 a second over three sockets (under FLOOD_N for each)
          clock.add(100);
          const g = rnd(), p = await cheerG(R.do, socks[i % 3], g);
          if (p?.why === 'dark' && p.g === g) dark++;
        }
        assert.equal(dark, 900, 'every made-up id is dark');
        assert.ok(factCalls(env) <= 4, 'one read at the start, then at most one per 30 s: ' + factCalls(env));
        assert.equal(env.calls.filter((c) => c === 'gift.giftCheerOf').length, 0, 'never a call per id');
        // At lean an unknown id never reads the list again before GF_LEAN.
        const setLvl = R.do.setLvl; R.do.setLvl = () => {}; R.do.lvl = 1; const n = factCalls(env); // the room's own report would set its level back
        for (let i = 0; i < 300; i++) { clock.add(1000); await cheerG(R.do, socks[i % 3], rnd()); }
        assert.ok(factCalls(env) - n <= 1, 'lean: one read in 300 s at most');
        R.do.setLvl = setLvl; R.do.lvl = 0; clock.add(300000);
        // A board that went up after the room read its list: dark while the list is under GF_MISS old, counted after.
        await cheerG(R.do, socks[1], rnd());
        const fresh = gift(env);
        assert.equal((await cheerG(R.do, socks[1], fresh)).why, 'dark');
        clock.add(30000);
        assert.equal((await cheerG(R.do, socks[1], fresh)).amount, PAY.cheer.base);
      } finally { restore(); }
    });
  });
  it('a board taken down (the operator hides it, its maker deletes it) stops counting at once: the rooms drop it from their list (GIFT_OFF)', async () => {
    await withClock(T0, async (clock) => {
      const restore = net([]);
      try {
        const env = makeEnv(), H = harness(env), R = env.room('chapel:square'), fan = sock(R.do, 'guest:fan'), id = gift(env), id2 = gift(env);
        assert.equal((await cheerG(R.do, fan, id)).amount, PAY.cheer.base);
        assert.equal((await cheerG(R.do, fan, id2)).amount, PAY.cheer.base);
        const r = await H.call('/rt/admin/gift/hide', { method: 'POST', headers: { 'x-admin-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
        assert.equal(r.status, 200); await H.settle();
        clock.add(PAY.cheer.gapMs); env.calls.length = 0;
        assert.deepEqual(await cheerG(R.do, fan, id), { t: 'PAY', kind: 'cheer', amount: 0, why: 'dark', g: id }, 'hidden: dark within the minute the list is kept');
        assert.equal((await cheerG(R.do, fan, id2)).amount, PAY.cheer.base, 'the other board still counts');
        assert.equal(factCalls(env), 0, 'no read for it');
        // A list read that started before the take-down cannot bring it back.
        R.do._gf.m.set(id, { uid: 'guest:maker', a: 0, b: Infinity, rev: 0 });
        clock.add(PAY.cheer.gapMs);
        assert.equal((await cheerG(R.do, fan, id)).why, 'dark');
        // Brought back by the operator: no room is told (it counts again once its list is read after GF_LEAN).
        await H.call('/rt/admin/gift/hide', { method: 'POST', headers: { 'x-admin-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify({ id, hide: false }) });
        await H.settle();
        assert.equal(env.calls.filter((c) => c === 'chapel:square.fetch').length, 0, 'bringing it back tells no room');
        // The room message itself: ids checked, nothing to the sockets.
        const n = fan.sent.length;
        const res = await R.do.fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'WORLD_UPDATE', kind: 'GIFT_OFF', data: { ids: [id2, '../x'] } }) }));
        assert.equal(res.status, 200); assert.equal(fan.sent.length, n);
        clock.add(PAY.cheer.gapMs);
        assert.equal((await cheerG(R.do, fan, id2)).why, 'dark');
      } finally { restore(); }
    });
  });
  it("the store's answer: the maker stays on the server; none for a hidden, gone or unknown board", () => {
    const env = makeEnv(), now = T0;
    const orig = Date.now; Date.now = () => now;
    try {
      const id = gift(env), q = env.meter('gift').do;
      const f = q.giftCheerOf(id, now);
      assert.deepEqual(Object.keys(f).sort(), ['a', 'b', 'rev', 'uid']);
      assert.equal(f.uid, 'guest:maker');
      assert.ok(f.rev <= now && f.a <= now && now < f.b);
      assert.equal(q.giftCheerOf(gift(env, { st: 'hidden' }), now), null);
      assert.equal(q.giftCheerOf('zz00zz00', now), null);
      assert.equal(q.giftCheerOf('../x', now), null);
      // /rt/world's public list still carries no maker; the rooms' list (server to server) is the boards up now only.
      assert.ok(q.giftLive(now).every((g) => !('uid' in g)));
      const all = q.giftCheerLive(now);
      assert.ok(all.some((g) => g.id === id && g.uid === 'guest:maker'));
      assert.deepEqual(all.map((g) => g.id).sort(), q.giftLive(now).map((g) => g.id).sort(), 'the same boards /rt/world shows');
    } finally { Date.now = orig; }
  });
});

describe('선물 전광판 응원: the page', () => {
  const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const main = read('main.js'), ui = read('ui.js'), screens = read('ts3d/screens.js'), world = read('timesSquare3d.js');
  it('the message: an 8-character gift id and a phrase, no slot', () => {
    assert.deepEqual(sendGiftCheer('ab12cd34', 3), { t: 'CHEER', g: 'ab12cd34', p: 3 });
    for (const bad of ['', 'AB12CD34', 'ab12cd3', 'STREET_8', null]) assert.equal(sendGiftCheer(bad, 1), null, String(bad));
    assert.equal(sendGiftCheer('ab12cd34', 0), null);
    assert.deepEqual(sendCheer('STREET_8', 4), { t: 'CHEER', slot: 'STREET_8', p: 4 }, 'the board cheer is unchanged');
  });
  it("a counted gift cheer answers PAY kind 'cheer': the same handler counts it toward 오늘 할 일 and says the same note", () => {
    assert.match(main, /if \(m\?\.kind === 'cheer' && got\) \{ ui\.quest\?\.\('cheer'\); ui\.note\(`응원 \+\$\{got\} 포인트`, 'ok', null, \{ key: 'cheer-paid' \}\); \}/);
    assert.match(main, /if \(m\?\.why === 'dark' && m\.g\) \{ ui\.giftNoCheer\?\.\(m\.g\);/);
    const fn = main.slice(main.indexOf('function cheerGift('), main.indexOf('\n}\n', main.indexOf('function cheerGift(')));
    assert.match(fn, /sendGiftCheer\(id, phraseId\)/);
    assert.match(fn, /net\.ch\?\.raw\?\.\(msg\)/);
    assert.match(fn, /PAY\.cheer\.gapMs/);
    assert.match(fn, /trackEvent\('gift_cheer', \{ slot: String\(slot \|\| ''\) \}\)/, 'its own event name');
    assert.doesNotMatch(fn, /trackEvent\('wish_cheer'/, 'not the lit board cheer\'s');
    assert.ok(EVENT_NAMES.includes('gift_cheer') && EVENT_NAMES.includes('wish_cheer'));
  });
  it('a tap on a gift screen opens its sheet with the cheer phrases; the far card cheers it; the world says which gift a screen shows', () => {
    assert.match(ui, /const gift = !boardActive\(b\) \? hooks\.giftOn\?\.\(slotId\) \|\| null : null;\n\s+if \(gift\) \{ openGiftScreen\(slotId, gift\); return; \}/);
    const sheet = ui.slice(ui.indexOf('  function openGiftScreen('), ui.indexOf('\n  }\n', ui.indexOf('  function openGiftScreen(')));
    assert.match(sheet, /CHEER_PHRASES\.map\(\(text, i\) => h\('button', \{ type: 'button', text, onclick: \(\) => hooks\.cheerGift\?\.\(g\.id, slotId, i \+ 1\) \}\)\)/);
    assert.match(sheet, /mine \? null : h\('div', \{ class: 'chips' \}/, 'no phrases on my own gift board');
    assert.match(ui, /const cheerBtn = act\('응원', \(\) => \(gift \? hooks\.cheerGift\?\.\(gift\.id, slot, 1\) : hooks\.cheer\?\.\(slot, 1\)\)\);/);
    assert.match(main, /cheerGift: \(id, slot, p\) => cheerGift\(id, slot, p\),/);
    assert.match(main, /giftScreens: \(\) => world\?\.giftScreens\?\.\(\) \|\| \[\],/);
    assert.match(world, /giftOn\(slot\) \{ return boards\.giftOn\(slot\); \},\n\s+giftScreens\(\) \{ return boards\.giftScreens\(\); \},/);
    assert.match(screens, /const giftPub = \(g\) => \(g && gifts\.has\(g\.id\) && !giftTeasing\(g\.id\)/, 'only the public live list, never a teaser or the welcome card');
    assert.match(main, /ui\.giftsIn\?\.\(\);/);
    const facts = read('worker.js').slice(read('worker.js').indexOf('  giftFacts(id) {'));
    assert.match(facts.slice(0, facts.indexOf('\n  }\n')), /this\.conns\+\+; \/\/ a DO call, counted toward the daily budget/, 'the gift store call is counted');
  });
});
