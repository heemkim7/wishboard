// Bot protection for the coin rewards, the page's side (docs/bot-protection.md; the Worker's side is test/reward-guard.test.mjs): net.js
// humanCall (a token of the reward's own action only while /rt/config names a Turnstile key, one silent retry on 403 human), the net.js calls
// that carry it, human.js tokens per action (quiet failures, one widget at a time), and how main.js and worker.js use them.
// Kept apart from reward-guard.test.mjs because net.js needs the browser globals below, and PGlite does not start under them.
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { webdriver: false, onLine: true, userAgent: 'node' }, configurable: true });
globalThis.document = { hidden: false, addEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.localStorage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { search: '?rt=do', hostname: 'masil.example.workers.dev', href: 'https://masil.example.workers.dev/', protocol: 'https:', origin: 'https://masil.example.workers.dev' };

const net = await import('../net.js');
const { GT_LS } = await import('../plaza-account.js');
const human = await import('../human.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const SITE = '0x4AAAAAAAtestSiteKey';
const HUMAN_NO = { ok: false, err: 'human', code: 'human', site: SITE, error: '사람인지 확인하지 못했어요. 다시 시도해 주세요.' };

describe('client: humanCall (net.js) for the coin rewards', { concurrency: false }, () => {
  const realToken = net.HUMAN.token;
  const reset = () => { net.HUMAN.token = realToken; net.HUMAN.site = ''; };
  it('switched off (no site key): no token asked, the call goes as before', async () => {
    try {
      reset(); let asked = 0; net.HUMAN.token = async () => { asked++; return 't'; };
      const seen = []; assert.deepEqual(await net.humanCall('bonus', async (ts) => { seen.push(ts); return { ok: true }; }), { ok: true });
      assert.deepEqual(seen, ['']); assert.equal(asked, 0);
    } finally { reset(); }
  });
  it('switched on: a token of the action first; a 403 human gets one more token and one more try; then a friendly error', async () => {
    try {
      reset(); net.HUMAN.site = SITE; const asked = []; let n = 0; net.HUMAN.token = async (site, action) => { asked.push(site + ' ' + action); return 'tok' + (++n); };
      const seen = []; const r = await net.humanCall('link', async (ts) => { seen.push(ts); if (seen.length === 1) throw Object.assign(new Error('x'), { code: 'human', site: SITE }); return { ok: true, amount: 300 }; });
      assert.deepEqual(r, { ok: true, amount: 300 }); assert.deepEqual(seen, ['tok1', 'tok2']); assert.deepEqual(asked, [SITE + ' link', SITE + ' link']);
      seen.length = 0; await assert.rejects(net.humanCall('bonus', async (ts) => { seen.push(ts); throw Object.assign(new Error('x'), { code: 'human', site: SITE }); }), (e) => e.code === 'human' && e.message === net.HUMAN_FAIL.bonus);
      assert.equal(seen.length, 2, 'one retry, not a loop');
      // No token from the widget: the call is not made.
      net.HUMAN.token = async () => ''; seen.length = 0;
      await assert.rejects(net.humanCall('code', async (ts) => { seen.push(ts); }), (e) => e.code === 'human' && e.message === net.HUMAN_FAIL.code); assert.deepEqual(seen, []);
      // Other errors (busy, already had today, a wrong code) pass through untouched, without a retry.
      net.HUMAN.token = async () => 't'; seen.length = 0;
      await assert.rejects(net.humanCall('bonus', async (ts) => { seen.push(ts); throw Object.assign(new Error('지금은 광장이 붐벼요. 잠시 뒤에 다시 해 주세요.'), { code: 'busy' }); }), (e) => e.code === 'busy'); assert.equal(seen.length, 1);
      for (const [action, text] of Object.entries(net.HUMAN_FAIL)) { assert.ok(['link', 'bonus', 'code'].includes(action)); assert.match(text, /^사람인지 확인하지 못해 /); }
    } finally { reset(); }
  });
  it('a page loaded before the switch went on: the 403 names the key, and the retry uses it', async () => {
    try {
      reset(); const asked = []; net.HUMAN.token = async (site, action) => { asked.push(site + ' ' + action); return 'T'; };
      const seen = []; const r = await net.humanCall('bonus', async (ts) => { seen.push(ts); if (!ts) throw Object.assign(new Error('x'), { code: 'human', site: SITE }); return { ok: true }; });
      assert.deepEqual(r, { ok: true }); assert.deepEqual(seen, ['', 'T']); assert.deepEqual(asked, [SITE + ' bonus']);
      await assert.rejects(net.humanCall('bonus', async () => { throw Object.assign(new Error('x'), { code: 'human', site: '' }); }), (e) => e.code === 'human', 'no key anywhere: give up at once');
    } finally { reset(); }
  });
  it('net.js sends ts only when there is one, and authed errors carry the site key', async () => {
    const origFetch = globalThis.fetch, bodies = [];
    try {
      localStorage.setItem(GT_LS, JSON.stringify({ token: 'g1.a.b', sub: 'g-00000000-0000-4000-8000-000000000009', exp: Math.floor(Date.now() / 1000) + 30 * 86400 }));
      globalThis.fetch = async (url, opt) => { bodies.push([String(url), JSON.parse(opt.body)]); return json({ ok: true }); };
      const n = new net.Net();
      await n.shareBonus(); await n.shareBonus('T1'); await n.redeemCode('GOLDCODE1'); await n.redeemCode('GOLDCODE1', 'T2'); await n.linkReward(); await n.linkReward('T3');
      assert.deepEqual(bodies, [['/rt/share-bonus', {}], ['/rt/share-bonus', { ts: 'T1' }], ['/rt/redeem-code', { code: 'GOLDCODE1' }], ['/rt/redeem-code', { code: 'GOLDCODE1', ts: 'T2' }], ['/rt/link-reward', {}], ['/rt/link-reward', { ts: 'T3' }]]);
      globalThis.fetch = async () => json(HUMAN_NO, 403);
      await assert.rejects(n.shareBonus(), (e) => e.code === 'human' && e.site === SITE);
      globalThis.fetch = async () => json({ ok: false, code: 'account', error: 'x' }, 403);
      await assert.rejects(n.shareBonus(), (e) => e.code === 'account' && e.site === '');
    } finally { globalThis.fetch = origFetch; localStorage.removeItem(GT_LS); }
  });
});

describe('client: human.js tokens for the rewards', () => {
  const el = (tag) => ({ tag, children: [], style: {}, attrs: {}, hidden: false, textContent: '', append(...k) { this.children.push(...k); }, setAttribute(k, v) { this.attrs[k] = v; } });
  const page = (load) => { const win = { location: { reload() { win.reloads = (win.reloads || 0) + 1; } } }, doc = { scripts: [], createElement: el, body: el('body'), head: { append(s) { doc.scripts.push(s); queueMicrotask(() => load(s, win)); } } }; return { win, doc, card: () => doc.body.children.find((c) => c.id === 'kts-human') }; };
  const api = (behave) => (s, win) => { win.turnstile = { renders: [], removed: [], render(host, o) { this.renders.push(o); queueMicrotask(() => behave(o, this.renders.length)); return 'w' + this.renders.length; }, remove(id) { this.removed.push(id); } }; s.onload(); };
  const visible = (c) => c.style.opacity === '1';
  it('renders with the action asked for; an unknown action is a guest check', async () => {
    const p = page(api((o, i) => o.callback('T' + i)));
    assert.equal(await human.humanToken(SITE, { ...p, action: 'link' }), 'T1'); assert.equal(p.win.turnstile.renders[0].action, 'link');
    assert.equal(await human.humanToken(SITE, { ...p, action: 'bonus' }), 'T2'); assert.equal(p.win.turnstile.renders[1].action, 'bonus');
    assert.equal(await human.humanToken(SITE, { ...p, action: 'code' }), 'T3'); assert.equal(p.win.turnstile.renders[2].action, 'code');
    assert.equal(await human.humanToken(SITE, { ...p, action: 'login' }), 'T4'); assert.equal(p.win.turnstile.renders[3].action, 'guest');
    assert.deepEqual(human.HUMAN_ACTIONS, ['guest', 'link', 'bonus', 'code']); assert.equal(p.doc.scripts.length, 1, 'one script for all of them');
    assert.deepEqual(p.win.turnstile.removed, ['w1', 'w2', 'w3', 'w4']);
  });
  it('a reward check that fails is quiet: no card, no reload button, and it neither sets nor obeys the guest failure', async () => {
    let fail = true; const p = page(api((o, i) => (fail ? o['error-callback']('600010') : o.callback('OK' + i))));
    assert.equal(await human.humanToken(SITE, { ...p, action: 'bonus' }), ''); assert.equal(visible(p.card()), false); assert.equal(p.win.reloads, undefined);
    fail = false; assert.equal(await human.humanToken(SITE, p), 'OK2', 'a guest check after it still runs');
    fail = true; assert.equal(await human.humanToken(SITE, p), ''); assert.equal(visible(p.card()), true, 'the guest failure says so');
    fail = false; assert.equal(await human.humanToken(SITE, { ...p, action: 'link' }), 'OK4', 'and a reward check after that still runs'); assert.equal(visible(p.card()), false);
    assert.equal(await human.humanToken(SITE, p), '', 'the guest check itself stays stopped after its failure'); assert.equal(p.win.turnstile.renders.length, 4);
    const blocked = page((s) => s.onerror()); assert.equal(await human.humanToken(SITE, { ...blocked, action: 'code' }), ''); assert.equal(blocked.card(), undefined, 'a blocked script: no card at all');
  });
  it('one widget at a time: a second action waits for the first; callers of one action share it; the tap card shows for a reward too', async () => {
    let go = null; const p = page(api((o) => { if (o.action === 'link') { o['before-interactive-callback'](); go = () => o.callback('L'); } else o.callback('B'); }));
    const a = human.humanToken(SITE, { ...p, action: 'link' }), a2 = human.humanToken(SITE, { ...p, action: 'link' }), b = human.humanToken(SITE, { ...p, action: 'bonus' });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(p.win.turnstile.renders.length, 1, 'bonus waits'); assert.equal(visible(p.card()), true); assert.equal(p.card().children[0].textContent, human.HUMAN_TEXT.tap);
    go(); assert.equal(await a, 'L'); assert.equal(await a2, 'L'); assert.equal(await b, 'B'); assert.equal(p.win.turnstile.renders.length, 2); assert.equal(visible(p.card()), false);
  });
});

describe('the pieces fit together', () => {
  const W_SRC = read('worker.js'), M = read('main.js'), N = read('net.js');
  it('worker.js asks each reward for its own action, and human.js knows them all', () => {
    for (const [route, action] of [['/rt/link-reward', 'link'], ['/rt/share-bonus', 'bonus'], ['/rt/redeem-code', 'code']]) {
      assert.ok(human.HUMAN_ACTIONS.includes(action)); assert.match(W_SRC, new RegExp("humanGate\\(env, req, [^\\n]*?, '" + action + "'\\)"), route);
    }
    assert.match(W_SRC, /u\.pathname === '\/rt\/share-bonus' \|\| u\.pathname === '\/rt\/redeem-code' \|\| u\.pathname === '\/rt\/link-reward'\) return promo\(req, env, u\)/);
  });
  it('main.js: the share bonus and codes go through humanCall; a held link reward is claimed after the link, never before it, and not by a following window', () => {
    assert.match(M, /shareBonus: async \(\) => \{ const r = await humanCall\('bonus', \(ts\) => net\.shareBonus\(ts\)\);/);
    assert.match(M, /redeemCode: async \(code\) => \{ const r = await humanCall\('code', \(ts\) => net\.redeemCode\(code, ts\)\);/);
    const fl = M.slice(M.indexOf('async function finishLink('), M.indexOf('async function bootAccount('));
    assert.ok(fl.indexOf('net.mergeGuest(') > 0 && fl.indexOf('net.mergeGuest(') < fl.indexOf('claimLinkReward(user, merged.held)'), 'the link goes first');
    assert.match(fl, /if \(merged\?\.held > 0 && !echo\) claimLinkReward\(user, merged\.held\);/);
    assert.doesNotMatch(fl, /await claimLinkReward/, 'not waited for');
    assert.match(fl, /const r = await humanCall\('link', \(ts\) => net\.linkReward\(ts\)\);/);
    // human.js is never imported up front: only net.js's HUMAN loads it, on demand.
    assert.doesNotMatch(M, /from '\.\/human\.js/); assert.doesNotMatch(N, /from '\.\/human\.js/);
    assert.match(N, /token: \(site, action\) => import\('\.\/human\.js\?v=\d+'\)\.then\(\(m\) => m\.humanToken\(site, \{ action \}\)\)/);
  });
});
