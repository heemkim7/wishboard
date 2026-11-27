// Share-page hits (people vs automated fetchers) and landed cheers (paid vs free), in the admin readout. Neither adds a DO call per event.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { W, makeEnv, harness, withClock } from './reinforce-harness.mjs';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const utcDay = () => new Date().toISOString().slice(0, 10); // Meter.add keys its budget row by the real clock
const setUsed = (env, n) => { env.meter('day').do.add(0); env.meter('day').sql.db.prepare('update d set n = ? where day = ?').run(n, utcDay()); };
function net(boards) {
  const orig = globalThis.fetch, origCaches = globalThis.caches;
  globalThis.fetch = async (url) => { const u = String(url);
    if (u.includes('/rest/v1/billboards')) { const m = /slot_id=eq\.(\w+)/.exec(u); return json(boards.filter((b) => !m || b.slot_id === m[1]).map((b) => ({ ...b }))); }
    if (u.includes('/rest/v1/')) return json([]);
    return json({ ok: true }); };
  globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return () => { globalThis.fetch = orig; globalThis.caches = origCaches; };
}
const lit = (slot, holder) => ({ slot_id: slot, holder_id: holder, holder_name: '주인', line1: '우리 가게', line2: '', line3: '', tier: 'C', updated_at: new Date(Date.now()).toISOString(), lit_until: new Date(Date.now() + 864e5).toISOString(), expires_at: null });

describe('share-page hits', { concurrency: false }, () => {
  it('splits people from link-preview fetchers, crawlers and requests without a User-Agent', () => {
    const people = ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 DaumApps/7.0', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 13; SM-S918N) NAVER(inapp; search; 2000; 12.0.0)', 'DaumApps/7.0', 'KAKAOTALK 10.4.5'];
    const auto = ['kakaotalk-scrap/1.0; +https://devtalk.kakao.com/', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Twitterbot/1.0', 'Slackbot-LinkExpanding 1.0',
      'Mozilla/5.0 (compatible; Discordbot/2.0)', 'TelegramBot (like TwitterBot)', 'WhatsApp/2.23.20.0', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)', 'Daumoa', 'Mozilla/5.0 (compatible; Daumoa/4.0)', 'LinkedInBot/1.0',
      'SomeCrawler/2', 'my-spider', 'Link Preview Service', '', '   ', null, undefined];
    for (const ua of people) assert.equal(W.linkWho(ua), 'people', ua);
    for (const ua of auto) assert.equal(W.linkWho(ua), 'auto', String(ua));
    assert.equal('LINK_KINDS' in W, false); // workerd takes only functions and classes as named exports (bot-guard.test.mjs)
  });
  it('counts each card page by kind and who, never waits for it, rides the tally add, skips redirects and HEAD, and stops at budget hard', async () => {
    await withClock(Date.parse('2027-06-01T03:00:00Z'), async (clock) => {
      const restore = net([lit('PLOT_9', 'guest:holder')]);
      try {
        const env = makeEnv(), { call, stats, ev } = harness(env);
        const page = (ua) => call('/rt/card/PLOT_9', { headers: ua == null ? {} : { 'user-agent': ua } });
        clock.add(60000); env.calls.length = 0;
        const first = await page('Mozilla/5.0 (iPhone) Mobile Safari');
        assert.equal(first.status, 200); assert.match(first.headers.get('content-type'), /^text\/html/);
        await page('Mozilla/5.0 (Android) Chrome'); await page('kakaotalk-scrap/1.0'); await page(null); await page('Twitterbot/1.0');
        assert.equal((await call('/rt/card/PLOT_9', { method: 'HEAD' })).status, 200); // a HEAD is not a page view
        assert.equal((await call('/rt/w/zzzzzzzzzz', { headers: { 'user-agent': 'Mozilla/5.0' } })).status, 302); // no such wish: a redirect, not counted
        assert.equal((await call('/rt/s/' + 'a'.repeat(32), { headers: { 'user-agent': 'Mozilla/5.0' } })).status, 302); // no such shot
        // Only the tally add carries the counts: no DO method of its own (the card page's own snapshot lookup is the page's, not the count's).
        assert.deepEqual(env.calls.filter((c) => c.startsWith('day.') && c !== 'day.add'), []);
        clock.add(30000); await ev('page_landing', 'sess-l-0001'); // a later request after TALLY_MS sends what is waiting
        let s = await stats();
        assert.deepEqual(s.days[0].links, { card: { people: 2, auto: 3 }, wish: { people: 0, auto: 0 }, shot: { people: 0, auto: 0 } });
        // Budget hard: nothing is counted (and no add is started for a hit).
        setUsed(env, 99000); clock.add(61000);
        assert.equal((await (await ev('page_landing', 'sess-l-0002')).json()).kept, false, 'the level came back hard');
        const adds = env.calls.filter((c) => c === 'day.add').length;
        await page('Mozilla/5.0 (iPhone)'); await page('kakaotalk-scrap/1.0');
        assert.equal(env.calls.filter((c) => c === 'day.add').length, adds, 'no add started by a hit at hard');
        setUsed(env, 0); clock.add(61000); await ev('page_landing', 'sess-l-0003'); clock.add(30000); await ev('page_landing', 'sess-l-0004');
        s = await stats();
        assert.deepEqual(s.days[0].links.card, { people: 2, auto: 3 }, 'the hits at hard were never counted');
      } finally { restore(); }
    });
  });
});

describe('landed cheers, paid and free', { concurrency: false }, () => {
  const sock = (room, id) => { const ws = { sent: [], send(s) { this.sent.push(JSON.parse(String(s))); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
    ws.a = { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 1500, y: 1500, fl: 0, name: '손님' } }; room.socks().set(ws, ws.a); return ws; };
  const cheer = async (room, ws, slot) => { const n = ws.sent.length; ws.a.ls = Date.now(); room.socks().set(ws, ws.a); await room.webSocketMessage(ws, JSON.stringify({ t: 'CHEER', slot, p: 1 })); return ws.sent.slice(n).find((m) => m.t === 'PAY' && m.kind === 'cheer'); };
  it("counts a paid cheer and one that landed after today's paid cheers ran out, with no DO call per cheer, and shows both per day", async () => {
    await withClock(Date.parse('2027-06-10T03:00:00Z'), async (clock) => {
      const restore = net([lit('PLOT_9', 'guest:holder'), lit('PLOT_10', 'guest:holder')]);
      try {
        const env = makeEnv(), { ev, stats } = harness(env), R = env.room('chapel:square'), b = sock(R.do, 'guest:fan');
        env.calls.length = 0;
        assert.equal((await cheer(R.do, b, 'PLOT_9')).amount, 4);
        R.sql.db.prepare("insert into ag(uid, k, d, v) values('guest:fan', 'dp:cheer', ?, 30) on conflict(uid, k, d) do update set v = 30").run('2027-06-10'); // today's paid cheers used up
        clock.add(13000);
        const full = await cheer(R.do, b, 'PLOT_10'); assert.deepEqual([full.amount, full.why], [0, 'full']);
        clock.add(13000);
        assert.deepEqual([(await cheer(R.do, b, 'PLOT_9')).why], ['full']);
        assert.deepEqual(R.sql.db.prepare('select d, paid, free from chd').all().map((r) => ({ ...r })), [{ d: '2027-06-10', paid: 1, free: 2 }]);
        assert.deepEqual(env.calls.filter((c) => c.startsWith('ad.')), [], 'nothing sent per cheer');
        await R.do.flushAds(); // the ad tallies' own flush hands the day counts over in the same call
        assert.equal(env.calls.filter((c) => c === 'ad.adAdd').length, 1);
        assert.deepEqual(R.sql.db.prepare('select count(*) n from chd').get().n, 0);
        await R.do.flushAds(); assert.equal(env.calls.filter((c) => c === 'ad.adAdd').length, 1, 'nothing left: no second call');
        await ev('page_landing', 'sess-c-0001');
        const s = await stats();
        assert.deepEqual(s.days[0].cheers, { paid: 1, free: 2 });
      } finally { restore(); }
    });
  });
  it('never counts a batch twice: a reply lost after the Meter applied it, or a throw in the ad ingest after the cheers, re-sends the same key', async () => {
    await withClock(Date.parse('2027-06-12T03:00:00Z'), async (clock) => {
      const restore = net([lit('PLOT_9', 'guest:holder')]);
      try {
        const env = makeEnv(), { ev, stats } = harness(env), R = env.room('chapel:square'), b = sock(R.do, 'guest:fan'), A = env.meter('ad').do;
        assert.equal((await cheer(R.do, b, 'PLOT_9')).amount, 4);
        // 1. The Meter applies the batch, then the answer is lost (the call throws on the way back).
        const real = A.adAdd.bind(A); let lose = 1;
        A.adAdd = async (...a) => { const out = await real(...a); if (lose-- > 0) throw new Error('reply lost'); return out; };
        await R.do.flushAds();
        assert.equal(R.sql.db.prepare('select count(*) n from chp').get().n, 1, 'the batch waits to be re-sent');
        clock.add(13000); assert.equal((await cheer(R.do, b, 'PLOT_9')).amount, 4); // a cheer landing meanwhile waits for the next batch
        await R.do.flushAds(); // the same key again: applied once; the new cheer is not in it
        assert.deepEqual([R.sql.db.prepare('select count(*) n from chp').get().n, R.sql.db.prepare('select paid from chd').get()?.paid], [0, 1]);
        await R.do.flushAds();
        // 2. adIngest throws after the cheers were applied: the re-send does not add them again.
        clock.add(13000); assert.equal((await cheer(R.do, b, 'PLOT_9')).amount, 4);
        let boom = 1;
        A.adAdd = async (items, people, cheers) => { if (boom-- > 0) { A.adI(); A.chAdd(cheers.k, cheers.rows); throw new Error('ingest failed'); } return real(items, people, cheers); };
        await R.do.flushAds(); await R.do.flushAds();
        assert.equal(A.chAdd('short', [{ d: '2027-06-12', paid: 5, free: 0 }]), false, 'a batch without a proper key is refused');
        await ev('page_landing', 'sess-c-0002');
        assert.deepEqual((await stats()).days[0].cheers, { paid: 3, free: 0 });
      } finally { restore(); }
    });
  });
});
