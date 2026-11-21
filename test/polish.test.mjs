// Package polish: the small client fixes from the final review.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { webdriver: false, onLine: true, userAgent: 'node' }, configurable: true });
globalThis.document = { hidden: false, addEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.localStorage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { search: '', hostname: 'localhost', href: 'http://localhost/', protocol: 'http:', origin: 'http://localhost' };

const { WISH_STEP, wishStep, firstStep } = await import('../ftue.js');
const share = await import('../share.js');
const { Net } = await import('../net.js');
const { leagueLine, liveSig } = await import('../league.js');
const { NINE, kingCovers } = await import('../live.js');

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const KEYV = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('1. the newcomer card does not offer a wish while the list is busy', () => {
  const steps = (s) => [() => { const text = wishStep(s); return text ? { k: 'wish' } : null; }, () => ({ k: 'goal' })];
  it('busy: the next step shows', () => {
    assert.equal(wishStep({ known: true, mine: false, skipped: false, busy: true }), '');
    assert.equal(firstStep(steps({ known: true, mine: false, busy: true })).k, 'goal');
    assert.equal(wishStep({ known: true, mine: false, skipped: false, busy: false }), WISH_STEP);
  });
  it('ui.js passes wishView.busy', () => {
    assert.match(read('ui.js'), /wishStep\(\{ known: wishView\.known, mine: !!wishView\.mine, skipped: wishSkipped, busy: wishView\.busy \}\)/);
  });
});

describe('2. the Kakao key comes from the one /rt/config read in net.js', () => {
  const withFetch = async (answer, fn) => {
    const calls = [], was = globalThis.fetch;
    globalThis.fetch = async (url) => { calls.push(String(url)); if (answer === 'down') throw new Error('offline'); return { ok: true, json: async () => answer }; };
    try { await fn(calls); } finally { globalThis.fetch = was; }
  };
  it('a key: kept on net, kakaoKey waits for loadConfig, one request in all', async () => {
    await withFetch({ url: 'https://x.supabase.co', key: 'pk', kakao: KEYV }, async (calls) => {
      const net = new Net();
      const early = net.kakaoKey(); // asked before the config arrived
      await net.loadConfig();
      assert.equal(await early, KEYV);
      assert.equal(await net.kakaoKey(), KEYV);
      assert.equal(net.kakao, KEYV);
      assert.deepEqual(calls, ['/rt/config']);
    });
  });
  it('no key, a bad key, or a failed read: an empty key', async () => {
    for (const answer of [{ url: 'https://x.supabase.co', key: 'pk' }, { url: 'u', key: 'k', kakao: 'short' }, 'down']) {
      await withFetch(answer, async (calls) => {
        const net = new Net();
        await net.loadConfig();
        assert.equal(await net.kakaoKey(), '');
        assert.equal(calls.length, 1);
      });
    }
  });
  it('share.js and ui.js make no /rt/config request of their own; ui reads the hook', () => {
    assert.doesNotMatch(read('share.js'), /\/rt\/config['"]/);
    assert.doesNotMatch(read('ui.js'), /fetch\([^)]*\/rt\/config/);
    assert.match(read('ui.js'), /const kakaoKey = \(\) => Promise\.resolve\(hooks\.kakaoKey\?\.\(\) \|\| ''\)/);
    assert.match(read('main.js'), /kakaoKey: \(\) => net\.kakaoKey\(\),/);
    assert.equal('kakaoKey' in share, false);
  });
  it('no key: loadKakao adds no script', async () => {
    const tags = [], doc = { head: { append(el) { tags.push(el); } }, createElement: () => ({}) };
    assert.equal(await share.loadKakao('', { doc, win: {} }), null);
    assert.equal(await share.kakaoSend('', { objectType: 'feed' }, { doc, win: {} }), false);
    assert.equal(tags.length, 0);
  });
});

describe('3. a hanging SDK load gives up after KAKAO_LOAD_MS', () => {
  it('is 3 s', () => assert.equal(share.KAKAO_LOAD_MS, 3000));
  it('no onload, no onerror: null after the timeout, remembered for the page, kakaoSend false', async () => {
    const tags = [], win = {}, doc = { head: { append(el) { tags.push(el); } }, createElement: () => ({}) };
    const t0 = Date.now();
    assert.equal(await share.loadKakao(KEYV, { doc, win, ms: 30 }), null);
    assert.ok(Date.now() - t0 >= 25);
    assert.equal(await share.kakaoSend(KEYV, { objectType: 'feed' }, { doc, win, ms: 30 }), false);
    assert.equal(tags.length, 1); // one script for the page
    // A late onload after the timeout does not flip the remembered failure.
    win.Kakao = { isInitialized: () => true, init() {}, Share: { sendDefault() {} } };
    tags[0].onload();
    assert.equal(await share.loadKakao(KEYV, { doc, win }), null);
  });
  it('a load inside the window still works', async () => {
    const win = {}, doc = { head: { append(el) { setTimeout(() => { win.Kakao = { isInitialized: () => false, init() {}, Share: { sendDefault() {} } }; el.onload(); }, 5); } }, createElement: () => ({}) };
    assert.equal(await share.kakaoSend(KEYV, { objectType: 'feed' }, { doc, win, ms: 200 }), true);
  });
});

describe('4. account link: no success toast after a failed merge', () => {
  it('main.js holds the success toast after a failure and still merges on every boot as before', () => {
    const m = read('main.js');
    const fl = m.slice(m.indexOf('async function finishLink('), m.indexOf('async function bootAccount('));
    assert.match(fl, /if \(guest\?\.id && guest\.token && guest\.id !== net\.id && mergedMark !== mark\) \{/);
    assert.match(fl, /catch \(e\) \{ failed = true; ui\.note\(authMessage\(e\), 'err'\); \}/);
    assert.match(fl, /else if \(fresh && !failed\) ui\.note\('계정을 연결했어요', 'ok'\)/);
    assert.doesNotMatch(m, /kts_merged_pair|MERGED_LS/);
  });
});

describe('6. the liveboard repaints only when what it shows changed', () => {
  it('liveSig follows names, coins, my rank and my line', () => {
    const rows = [{ nick: 'A', spent: 10 }, { nick: 'B', spent: 5 }];
    const me = { rank: 2, spent: 5, next: { rank: 1, gap: 6 } };
    const s = liveSig(rows, me);
    assert.equal(liveSig(rows.map((r) => ({ ...r })), { ...me }), s);
    assert.notEqual(liveSig([{ nick: 'A', spent: 11 }, rows[1]], me), s);
    assert.notEqual(liveSig([{ nick: 'C', spent: 10 }, rows[1]], me), s);
    assert.notEqual(liveSig(rows, { ...me, next: { rank: 1, gap: 7 } }), s);
    assert.notEqual(liveSig(rows, null), s);
    assert.notEqual(liveSig([], null), liveSig(rows, null));
  });
  it('paintLive skips while newcomer mode hides it and when the signature is unchanged', () => {
    const ui = read('ui.js');
    const fn = ui.slice(ui.indexOf('  function paintLive() {'), ui.indexOf('rankRows.replaceChildren('));
    assert.match(fn, /if \(newbieOn\) return;/);
    assert.match(fn, /const sig = liveSig\(rows, me\);\n\s*if \(sig === liveSigNow\) return;/);
  });
});

describe('7. the unranked league line', () => {
  it('says coins spent put you on the list', () => {
    assert.equal(leagueLine({ rank: 0, spent: 0, next: { rank: 1, gap: 1 } }), '이번 주 순위는 0에서 시작했어요 · 코인을 쓰면 순위에 올라요');
  });
});

describe('8. the wish king over lit boards is one switch', () => {
  it('NINE.overLit is on: every board, lit or not', () => {
    assert.equal(NINE.overLit, true);
    assert.equal(kingCovers(true), true);
    assert.equal(kingCovers(false), true);
  });
  it('off: only boards with no live holder', () => {
    assert.equal(kingCovers(true, false), false);
    assert.equal(kingCovers(false, false), true);
  });
  it('screens.js kingFor asks it with the board row', () => {
    assert.match(read('ts3d/screens.js'), /function kingFor\(b\) \{[^\n]*&& kingCovers\(live\(b\.row\)\); \}/);
  });
});
