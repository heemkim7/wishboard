// Account and sign-in: the second window of the Google sign-in (oauth.html, run here in a stub page), the policy text module,
// and source checks for the parts that only a browser can run (the popup wiring, the nickname rule, the in-game policy links).
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { oauthMessage, oauthReturn, oauthErrorText, oauthErrorKind, sessionDrift, OAUTH_ACK, OAUTH_CHANNEL, OAUTH_ERR, GT_LS, SESSION_LS } from '../plaza-account.js';
import { policyDoc, policyKind } from '../legal.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a + ' … ' + b); return src.slice(i, j); };

const OAUTH_HTML = read('oauth.html');
const OAUTH_JS = /<script>([\s\S]*?)<\/script>/.exec(OAUTH_HTML)[1];
const ORIGIN = 'https://studio.wishboard.workers.dev';
const CODE = '0b6c5a2e-7f1d-4c3b-9a8e-2d1f0e9c8b7a';

// A stub of the window Supabase sends back to /oauth. tick(n) runs n × 100 ms of the page's interval; run() fires pending timeouts.
function page({ search = '', hash = '', opener = null, channel = true } = {}) {
  let clock = 1000;
  const intervals = new Map(), timeouts = [], listeners = [], channels = [];
  let seq = 0;
  const els = { msg: { textContent: '' }, more: { hidden: true } };
  const location = { search, hash, pathname: '/oauth', origin: ORIGIN, replaced: null, replace(u) { this.replaced = u; } };
  const history = { url: null, replaceState(state, title, url) { this.url = url; } };
  const window = { opener, closeCalls: 0, close() { this.closeCalls += 1; } };
  class BC {
    constructor(name) { this.name = name; this.sent = []; this.onmessage = null; channels.push(this); }
    postMessage(m) { this.sent.push(m); }
  }
  const ctx = {
    window, location, history, URLSearchParams, encodeURIComponent, String,
    document: { getElementById: (id) => els[id] },
    Date: { now: () => clock },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    setInterval: (fn) => { intervals.set(++seq, fn); return seq; },
    clearInterval: (id) => { intervals.delete(id); },
    setTimeout: (fn) => { timeouts.push(fn); return 0; },
  };
  if (channel) ctx.BroadcastChannel = BC;
  runInNewContext(OAUTH_JS, ctx);
  return {
    els, location, history, window, intervals,
    chan: channels[0] || null,
    tick(n = 1) { for (let i = 0; i < n; i++) { clock += 100; for (const fn of [...intervals.values()]) fn(); } },
    run() { for (const fn of timeouts.splice(0)) fn(); },
    ackByChannel() { channels[0].onmessage({ data: { t: OAUTH_ACK } }); },
    ackByWindow(origin = ORIGIN) { for (const fn of listeners) fn({ origin, data: { t: OAUTH_ACK } }); },
  };
}

describe('oauth.html: the second window of the Google sign-in', () => {
  it('is a small static page with the game background and nothing that writes HTML or loads code', () => {
    assert.ok(OAUTH_HTML.length < 6000, String(OAUTH_HTML.length));
    assert.match(OAUTH_HTML, /background: #0a0e1c; color: #f2f4ff/);
    assert.equal((OAUTH_HTML.match(/<script/g) || []).length, 1);
    assert.doesNotMatch(OAUTH_HTML, /<script[^>]+src=|<link[^>]+href=|import\s*\(|\bimport\s/);
    assert.doesNotMatch(OAUTH_HTML, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    assert.doesNotMatch(OAUTH_HTML, /gtag|googletagmanager|clarity|jsdelivr|createClient|fetch\(|XMLHttpRequest|sendBeacon/i); // no analytics, no client library, no requests
    assert.match(OAUTH_HTML, /<meta name="referrer" content="no-referrer"/);
    assert.match(OAUTH_JS, new RegExp("new BroadcastChannel\\('" + OAUTH_CHANNEL + "'\\)"));
    assert.match(OAUTH_JS, /window\.opener\.postMessage\(out, location\.origin\)/);
  });

  it('hands the code to the game tab, takes it out of its own address, and closes once the tab answers', () => {
    const opener = { closed: false, got: [], postMessage(m, origin) { this.got.push([m, origin]); } };
    const p = page({ search: '?code=' + CODE, opener });
    assert.equal(p.history.url, '/oauth'); // the code left the address bar before anything else
    assert.deepEqual(oauthMessage(p.chan.sent[0]), { code: CODE }); // the shape main.js accepts
    assert.equal(opener.got.length, 1);
    assert.deepEqual(oauthMessage(opener.got[0][0]), { code: CODE });
    assert.equal(opener.got[0][1], ORIGIN); // never '*'
    p.ackByChannel();
    p.tick();
    assert.equal(p.window.closeCalls, 1);
    assert.equal(p.location.replaced, null);
    assert.equal(p.intervals.size, 0);
    p.run(); // still open: the browser refused to close it
    assert.equal(p.els.msg.textContent, '로그인이 끝났어요. 이 창을 닫고 광장으로 돌아가세요');
    assert.equal(p.els.more.hidden, true);
  });

  it('accepts the answer through window.postMessage from its own origin only', () => {
    const a = page({ search: '?code=' + CODE, channel: false, opener: { closed: false, postMessage() {} } });
    assert.equal(a.chan, null);
    a.ackByWindow('https://evil.example');
    a.tick(3);
    assert.equal(a.window.closeCalls, 0);
    a.ackByWindow();
    a.tick();
    assert.equal(a.window.closeCalls, 1);
    assert.equal(a.location.replaced, null);
  });

  it('with no answer for about 1.5 s it becomes the game and finishes there with ?code=', () => {
    const odd = 'a b&c=d/é';
    const p = page({ search: '?code=' + encodeURIComponent(odd) });
    p.tick(14);
    assert.equal(p.location.replaced, null);
    assert.ok(p.chan.sent.length >= 3, 'said more than once: ' + p.chan.sent.length);
    p.tick();
    assert.equal(p.location.replaced, '/?code=' + encodeURIComponent(odd));
    assert.equal(p.window.closeCalls, 0);
    assert.equal(p.intervals.size, 0);
    p.ackByChannel(); // too late: nothing more happens
    p.tick(5);
    assert.equal(p.window.closeCalls, 0);
  });

  it('reports a provider error (query or hash), and without a game tab says so in plain text with a way back', () => {
    const p = page({ search: '?error=access_denied&error_code=access_denied&error_description=User+denied+%3Cb%3Eaccess' });
    assert.deepEqual(oauthMessage(p.chan.sent[0]), { error: 'access_denied', errorCode: 'access_denied', description: 'User denied <b>access' });
    p.tick(15);
    assert.equal(p.location.replaced, null); // an error is never forwarded to the game address
    assert.equal(p.els.msg.textContent, '로그인을 취소했어요.');
    assert.equal(p.els.more.hidden, false);
    const h = page({ hash: '#error=server_error&error_description=' + 'x'.repeat(400) });
    const m = oauthMessage(h.chan.sent[0]);
    assert.equal(m.error, 'server_error');
    assert.equal(m.description.length, 200);
    h.ackByChannel();
    h.tick();
    assert.equal(h.window.closeCalls, 1);
    const none = page({});
    assert.deepEqual(oauthMessage(none.chan.sent[0]), { error: 'no_code', errorCode: '', description: '' });
    none.tick(15);
    assert.equal(none.els.msg.textContent, '로그인을 마치지 못했어요. 광장에서 다시 시도해 주세요.');
  });

  it('does not throw when the opener is gone or closed', () => {
    const closed = page({ search: '?code=' + CODE, opener: { closed: true, postMessage() { throw new Error('closed'); } } });
    closed.tick(15);
    assert.equal(closed.location.replaced, '/?code=' + CODE);
    const hostile = page({ search: '?code=' + CODE, opener: { get closed() { throw new Error('cross-origin'); } } });
    hostile.tick(15);
    assert.equal(hostile.location.replaced, '/?code=' + CODE);
  });
});

const plain = (v) => JSON.parse(JSON.stringify(v)); // objects made inside the stub page belong to another realm
// The game-tab half (main.js, from OAUTH_KEEP_MS to passwordSign) run with stubs for the window, the channel, net and ui.
function opener({ blocked = false, inApp = false, session = { user: { id: 'u-1' } }, exchange = 'ok', stored = null, sheetOpen = true } = {}) {
  const src = between(read('main.js').replace(/\r\n/g, '\n'), '\nconst OAUTH_KEEP_MS = 10 * 60000;', '\nasync function passwordSign(');
  let clock = 5000;
  const intervals = new Map(), winListeners = {}, channels = [];
  let seq = 0;
  const calls = { open: [], setLogin: [], closeLogin: 0, finishLink: [], exchange: [], oauthUrl: [], startOAuth: [], savePlace: 0, order: [], notes: [], ops: 0 };
  const popup = { closed: false, location: null, posted: [], closeCalls: 0, document: { title: '', body: { style: {}, textContent: '' } }, postMessage(m, o) { this.posted.push([m, o]); }, close() { this.closeCalls += 1; this.closed = true; } };
  let urlDone = null;
  class BC { constructor(name) { this.name = name; this.sent = []; this.onmessage = null; channels.push(this); } postMessage(m) { this.sent.push(m); } }
  const ctx = {
    oauthMessage, OAUTH_ACK, OAUTH_CHANNEL,
    oauthErrorText: (r) => 'ERR:' + r.error,
    authMessage: (e) => 'AUTH:' + (e?.message || ''),
    isInAppWebView: () => inApp,
    navigator: { userAgent: 'x' },
    location: { origin: ORIGIN },
    BroadcastChannel: BC,
    Date: { now: () => clock },
    setInterval: (fn) => { intervals.set(++seq, fn); return seq; },
    clearInterval: (id) => { intervals.delete(id); },
    setTimeout: () => 0,
    sleep: () => Promise.resolve(),
    savePlace: () => { calls.savePlace += 1; calls.order.push('savePlace'); },
    finishLink: async (s, fresh) => { calls.finishLink.push([s, fresh]); },
    actorOp: async (run) => { calls.ops += 1; return run(); }, // main.js: syncActor waits while one of these runs
    ui: { setLogin: (v) => calls.setLogin.push(v), closeLogin: () => { calls.closeLogin += 1; }, loginOpen: () => sheetOpen, note: (text, kind) => calls.notes.push([text, kind]) },
    net: {
      oauthUrl: (provider, redirectTo) => { calls.oauthUrl.push([provider, redirectTo]); return new Promise((resolve, reject) => { urlDone = { resolve, reject }; }); },
      exchangeCode: async (code) => { calls.exchange.push(code); if (exchange !== 'ok') throw new Error('used'); return session; },
      currentSession: async () => stored,
      startOAuth: async (provider) => { calls.startOAuth.push(provider); calls.order.push('redirect'); },
    },
  };
  ctx.window = { open: (...a) => { calls.open.push(a); return blocked ? null : popup; }, addEventListener: (type, fn) => { winListeners[type] = fn; } };
  runInNewContext(src + '\nthis.startOAuth = startOAuth;', ctx);
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    calls, popup, chan: () => channels[0], settle,
    start: () => ctx.startOAuth('google'),
    url: async (u) => { urlDone.resolve(u); await settle(); },
    urlFail: async (e) => { urlDone.reject(e); await settle(); },
    byChannel: async (data) => { channels[0].onmessage({ data }); await settle(); },
    byWindow: async (data, origin = ORIGIN, source = popup) => { winListeners.message({ origin, data, source }); await settle(); },
    poll(n = 1, ms = 500) { for (let i = 0; i < n; i++) { clock += ms; for (const fn of [...intervals.values()]) fn(); } },
    polls: () => intervals.size,
    last: () => calls.setLogin[calls.setLogin.length - 1],
  };
}

describe('the game tab during a Google sign-in (main.js, stubbed)', () => {
  it('opens the window before anything asynchronous, loads the provider address into it, and finishes on the code', async () => {
    const o = opener();
    o.start();
    assert.deepEqual(o.calls.open, [['', 'kts_oauth', 'popup,width=480,height=680']]); // already open when the click handler returns
    assert.deepEqual(o.calls.oauthUrl, [['google', ORIGIN + '/oauth']]);
    assert.equal(o.last().wait, true);
    assert.equal(o.popup.location, null);
    await o.url('https://accounts.example/authorize?x=1');
    assert.equal(o.popup.location, 'https://accounts.example/authorize?x=1');
    await o.byChannel({ t: 'kts-oauth', code: CODE });
    assert.deepEqual(plain(o.chan().sent), [{ t: OAUTH_ACK }]); // answered
    assert.deepEqual(plain(o.popup.posted), [[{ t: OAUTH_ACK }, ORIGIN]]);
    assert.deepEqual(o.calls.exchange, [CODE]);
    assert.deepEqual(o.calls.finishLink, [[{ user: { id: 'u-1' } }, true]]);
    assert.equal(o.calls.closeLogin, 1);
    assert.equal(o.last().wait, false);
    assert.equal(o.polls(), 0);
    // The same result again (the window says it over both channels), or any later message: nothing pending, so nothing happens.
    await o.byWindow({ t: 'kts-oauth', code: CODE });
    await o.byChannel({ t: 'kts-oauth', code: CODE });
    assert.equal(o.calls.exchange.length, 1);
    assert.equal(o.chan().sent.length, 1);
  });
  it('ignores a message when no attempt is pending, a wrong shape, and another origin', async () => {
    const idle = opener();
    await idle.byChannel({ t: 'kts-oauth', code: CODE });
    assert.equal(idle.calls.exchange.length, 0);
    assert.deepEqual(idle.chan().sent, []); // no answer: the window then finishes on its own
    const o = opener();
    o.start();
    await o.url('https://accounts.example/a');
    await o.byWindow({ t: 'kts-oauth', code: CODE }, 'https://evil.example');
    await o.byChannel({ t: 'kts-oauth', code: 'x y' });
    await o.byChannel({ code: CODE });
    assert.equal(o.calls.exchange.length, 0);
    assert.equal(o.last().wait, true); // still waiting
    await o.byWindow({ t: 'kts-oauth', code: CODE });
    assert.deepEqual(o.calls.exchange, [CODE]);
  });
  it('gives the button back when the window is closed, and still takes a result that arrives after that', async () => {
    const o = opener();
    o.start();
    await o.url('https://accounts.example/a');
    o.poll(2);
    assert.equal(o.last().wait, true);
    o.popup.closed = true;
    o.poll();
    assert.equal(o.last().wait, false);
    const n = o.calls.setLogin.length;
    o.poll(3);
    assert.equal(o.calls.setLogin.length, n); // said once
    await o.byChannel({ t: 'kts-oauth', code: CODE });
    assert.deepEqual(o.calls.exchange, [CODE]);
    assert.equal(o.calls.finishLink.length, 1);
    // After ten minutes an unanswered attempt is dropped.
    const old = opener();
    old.start();
    await old.url('https://accounts.example/a');
    old.poll(1, 10 * 60000 + 1);
    assert.equal(old.polls(), 0);
    assert.equal(old.last().wait, false);
    await old.byChannel({ t: 'kts-oauth', code: CODE });
    assert.equal(old.calls.exchange.length, 0);
  });
  it('shows a provider error or a failed exchange in the sheet and does not close it', async () => {
    const o = opener();
    o.start();
    await o.url('https://accounts.example/a');
    await o.byChannel({ t: 'kts-oauth', error: 'access_denied' });
    assert.deepEqual(plain(o.chan().sent), [{ t: OAUTH_ACK }]);
    assert.equal(o.last().err, 'ERR:access_denied');
    assert.equal(o.last().wait, false);
    assert.equal(o.calls.exchange.length + o.calls.closeLogin, 0);
    const bad = opener({ exchange: 'fail' });
    bad.start();
    await bad.url('https://accounts.example/a');
    await bad.byChannel({ t: 'kts-oauth', code: CODE });
    assert.equal(bad.last().err, 'AUTH:used');
    assert.equal(bad.calls.finishLink.length + bad.calls.closeLogin, 0);
    // The code was already used by the window itself: the session it stored is taken instead.
    const late = opener({ exchange: 'fail', stored: { user: { id: 'u-2' } } });
    late.start();
    await late.url('https://accounts.example/a');
    await late.byChannel({ t: 'kts-oauth', code: CODE });
    assert.deepEqual(late.calls.finishLink, [[{ user: { id: 'u-2' } }, true]]);
    assert.equal(late.calls.closeLogin, 1);
    // No provider address (client not ready): the window closes and the reason is shown.
    const down = opener();
    down.start();
    await down.urlFail(new Error('로그인 준비 중이에요'));
    assert.equal(down.popup.closeCalls, 1);
    assert.equal(down.last().err, 'AUTH:로그인 준비 중이에요');
    assert.equal(down.polls(), 0);
    // With the sheet on screen every one of these is a line in it, never a toast as well.
    assert.deepEqual([o.calls.notes, bad.calls.notes, late.calls.notes, down.calls.notes], [[], [], [], []]);
  });
  it('says a sign-in error as a toast when the login sheet was closed meanwhile (the sheet clears its line when it opens again)', async () => {
    const o = opener({ sheetOpen: false });
    o.start();
    await o.url('https://accounts.example/a');
    await o.byChannel({ t: 'kts-oauth', error: 'access_denied' });
    assert.deepEqual(o.calls.notes, [['ERR:access_denied', 'err']]);
    assert.equal(o.last().err, 'ERR:access_denied'); // and still in the sheet's state, for a sheet that is only covered
    const bad = opener({ exchange: 'fail', sheetOpen: false });
    bad.start();
    await bad.url('https://accounts.example/a');
    await bad.byChannel({ t: 'kts-oauth', code: CODE });
    assert.deepEqual(bad.calls.notes, [['AUTH:used', 'err']]);
    const down = opener({ sheetOpen: false });
    down.start();
    await down.urlFail(new Error('로그인 준비 중이에요'));
    assert.deepEqual(down.calls.notes, [['AUTH:로그인 준비 중이에요', 'err']]);
    // A sign-in that worked says nothing more than finishLink does.
    const ok = opener({ sheetOpen: false });
    ok.start();
    await ok.url('https://accounts.example/a');
    await ok.byChannel({ t: 'kts-oauth', code: CODE });
    assert.deepEqual(ok.calls.notes, []);
    assert.equal(ok.calls.ops, 1, 'the exchange and the link run as one actorOp');
    assert.match(read('ui.js'), /loginOpen: \(\) => !!sheet\?\.login,/);
  });
  it('falls back to the full-page sign-in when the window is blocked, after saving the place, and does nothing in an in-app browser', async () => {
    const o = opener({ blocked: true });
    o.start();
    assert.equal(o.last().info, '새 창이 막혀 있어 이 화면에서 로그인합니다');
    assert.equal(o.last().wait, true);
    await o.settle();
    assert.deepEqual(o.calls.order, ['savePlace', 'redirect']);
    assert.deepEqual(o.calls.startOAuth, ['google']);
    assert.equal(o.calls.oauthUrl.length, 0);
    const app = opener({ inApp: true });
    app.start();
    assert.equal(app.calls.open.length + app.calls.startOAuth.length + app.calls.setLogin.length, 0);
  });
});

describe('a provider error is said with a fixed line', () => {
  const FIXED = new Set(Object.values(OAUTH_ERR));
  it('maps the known codes, and everything else to one plain line', () => {
    assert.equal(oauthErrorText({ error: 'access_denied' }), '구글 로그인을 취소했어요');
    assert.equal(oauthErrorText({ error: 'access_denied', errorCode: 'signup_disabled' }), '지금은 새 계정을 만들 수 없어요');
    assert.equal(oauthErrorText({ error: 'access_denied', errorCode: 'user_banned', description: 'User is banned' }), OAUTH_ERR.banned);
    assert.equal(oauthErrorText({ error: 'access_denied', errorCode: 'provider_disabled' }), OAUTH_ERR.provider);
    for (const code of ['bad_oauth_state', 'bad_oauth_callback', 'flow_state_expired', 'flow_state_not_found']) assert.equal(oauthErrorText({ error: 'invalid_request', errorCode: code }), '로그인 시간이 지났어요. 다시 시도해 주세요.', code);
    assert.equal(oauthErrorText({ error: 'server_error', errorCode: 'over_request_rate_limit' }), OAUTH_ERR.rate);
    assert.equal(oauthErrorText({ error: 'access_denied', errorCode: 'provider_email_needs_verification' }), OAUTH_ERR.verify);
    assert.equal(oauthErrorText({ error: 'server_error', errorCode: 'identity_already_exists' }), OAUTH_ERR.exists);
    for (const r of [{ error: 'server_error', errorCode: 'unexpected_failure' }, { error: 'no_code' }, { error: 'whatever' }, {}, null, undefined]) assert.equal(oauthErrorText(r), '로그인하지 못했어요. 다시 시도해 주세요.');
    assert.equal(oauthErrorKind({ error: 'ACCESS_DENIED', errorCode: 'SIGNUP_DISABLED' }), 'signup');
    for (const line of FIXED) assert.match(line, /[가-힣]/);
  });
  it('never shows text from the address: not in the toast after a full-page return, not in the sheet after the Google window', () => {
    const lure = '계정이 잠겼어요. evil.example 로 가서 비밀번호를 다시 넣으세요 <b>지금</b>';
    for (const error of ['access_denied', 'server_error', 'invalid_request', lure, '']) {
      for (const errorCode of ['', 'user_banned', 'unexpected_failure', lure]) {
        const q = '?error=' + encodeURIComponent(error) + '&error_code=' + encodeURIComponent(errorCode) + '&error_description=' + encodeURIComponent(lure);
        const arrived = oauthReturn(q, '');                       // main.js bootAccount: ui.note(oauthErrorText(ARRIVED), 'err')
        const text = oauthErrorText(arrived);
        assert.ok(FIXED.has(text), text);
        const said = oauthMessage({ t: 'kts-oauth', error: error || 'no_code', errorCode, description: lure }); // what oauth.html posts for /oauth?error=
        assert.ok(FIXED.has(oauthErrorText(said)), oauthErrorText(said));
      }
    }
    assert.ok(FIXED.has(oauthErrorText(oauthReturn('', '#error=server_error&error_description=' + encodeURIComponent(lure)))));
    // The window itself only ever says one of its two own lines.
    assert.match(OAUTH_JS, /say\(error === 'access_denied' \? '로그인을 취소했어요\.' : '로그인을 마치지 못했어요\. 광장에서 다시 시도해 주세요\.', true\);/);
    assert.doesNotMatch(OAUTH_JS, /say\([^)]*description/);
    assert.doesNotMatch(read('plaza-account.js'), /로그인하지 못했어요 \(/);
  });
});

describe('one actor per window: what a window does about the session other windows share', () => {
  it('follows a sign-in, a sign-out and another account; does nothing when it cannot tell', () => {
    assert.equal(sessionDrift({ have: '', known: true, user: 'u-1' }), 'in');
    assert.equal(sessionDrift({ have: 'u-1', known: true, user: '' }), 'out');
    assert.equal(sessionDrift({ have: 'u-1', known: true, user: 'u-2' }), 'swap');
    assert.equal(sessionDrift({ have: 'u-1', known: true, user: 'u-1' }), 'none');
    assert.equal(sessionDrift({ have: '', known: true, user: '' }), 'none');
    // A refresh that failed or a missing client is not a sign-out.
    assert.equal(sessionDrift({ have: 'u-1', known: false, user: '' }), 'none');
    assert.equal(sessionDrift({ have: '', known: false, user: 'u-1' }), 'none');
    assert.equal(sessionDrift(), 'none');
  });
  it('net.js tells "none stored" from "cannot tell", and hands auth events on in a later task', () => {
    const net = read('net.js');
    const stored = between(net, 'async storedSession() {', 'onAuth(fn) {');
    assert.match(stored, /if \(r\.data\?\.session\?\.user\?\.id\) return \{ session: r\.data\.session \}; if \(r\.error\) return null;/);
    assert.match(stored, /return localStorage\.getItem\(SESSION_LS\) \? null : \{ session: null \};/);
    const on = between(net, 'onAuth(fn) {', '\n  // Google sign-in.');
    assert.match(on, /auth\.onAuthStateChange\(\(ev\) => \{ if \(ev === 'SIGNED_IN' \|\| ev === 'SIGNED_OUT'\) setTimeout\(/);
    assert.doesNotMatch(on, /getSession|await /); // nothing of the client is called inside its own callback
    const main = read('main.js');
    assert.match(main, /net\.onAuth\(\(\) => askSync\(0\)\);/);
    assert.match(main, /try \{ await actorOp\(bootAccount\); \}/);
  });
});

// The part of main.js that keeps one actor per window (its header to withdrawAccount), run with stubs. stored: what the shared
// storage holds as net.storedSession() answers it. look() is the page being looked at again; run() lets the queued sync finish.
function actorWin({ user = '', guest = { sub: 'g-old', token: 't-old' }, linked = '' } = {}) {
  const src = between(read('main.js').replace(/\r\n/g, '\n'), '\n// ---- one actor per window', '\nasync function withdrawAccount() {');
  const bag = new Map();
  if (guest) bag.set(GT_LS, JSON.stringify(guest));
  const timers = new Map(), listeners = {};
  let seq = 0;
  const calls = { finishLink: [], notes: [], setAccount: [], resendPush: [], guestToken: [], forget: 0, dropTry: 0, closeLogin: 0, wallet: 0, removed: [] };
  const w = { stored: { session: null }, calls, bag };
  const ctx = {
    GT_LS, SESSION_LS, INV_CODE_KEY: 'kts_inv_code', sessionDrift, console: { warn() {} },
    localStorage: { getItem: (k) => (bag.has(k) ? bag.get(k) : null), setItem: (k, v) => bag.set(k, String(v)), removeItem: (k) => { calls.removed.push(k); bag.delete(k); } },
    sessionStorage: { removeItem() {} },
    setTimeout: (fn) => { timers.set(++seq, fn); return seq; },
    clearTimeout: (id) => { timers.delete(id); },
    sleep: () => Promise.resolve(),
    window: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    document: { visibilityState: 'visible', addEventListener: (type, fn) => { listeners[type] = fn; } },
    Net: { cid: () => 'cid' },
    net: { id: user ? 'user:' + user : (guest ? 'guest:' + guest.sub : 'cid'), storedSession: async () => w.stored },
    state: { grants: [{ n: 5, at: 1 }], pending: 5, confirmed: 120, vipTickets: 1, walletKnown: true, invite: {}, league: {}, starterUsed: true },
    ui: {
      setWallet() {}, forgetActor: () => { calls.forget += 1; }, setAccount: (v) => calls.setAccount.push(v), refreshProfile() {},
      note: (text) => calls.notes.push(text), setLogin() {}, closeLogin: () => { calls.closeLogin += 1; }, openLogin() {},
      resendPush: (o) => calls.resendPush.push(o),
    },
    guestToken: async (fresh) => { calls.guestToken.push(!!fresh); const g = { sub: 'g-made' + calls.guestToken.length, token: 't-made' }; bag.set(GT_LS, JSON.stringify(g)); return g; },
    guestActor: () => { try { const g = JSON.parse(bag.get(GT_LS) || 'null'); return g?.sub ? { id: 'guest:' + g.sub, token: g.token || '' } : null; } catch { return null; } },
    refreshWallet: async () => { calls.wallet += 1; }, refreshWorld: async () => {}, rejoin: async () => {}, pullProfile() {}, loadWishes: async () => {},
    dropOAuthTry: () => { calls.dropTry += 1; },
  };
  ctx.finishLink = async (s, fresh, echo) => { calls.finishLink.push([s.user.id, fresh, echo]); ctx.api.setUser(s.user); };
  const pre = `let sessionUser = ${user ? JSON.stringify({ id: user }) : 'null'}, accountReady = true, linkedGuest = ${JSON.stringify(linked)}, actorOps = 0, syncAsked = false, syncing = false, syncTimer = 0, walletGen = 0;\n`;
  runInNewContext(pre + src + '\nthis.api = { syncActor, actorOp, becomeGuest, who: () => (sessionUser ? sessionUser.id : \'\'), setUser: (u) => { sessionUser = u; } };', ctx);
  const settle = () => new Promise((r) => setImmediate(r));
  w.api = ctx.api;
  w.net = ctx.net;
  w.state = ctx.state;
  w.look = () => listeners.visibilitychange();
  w.storage = (key) => listeners.storage({ key });
  w.pending = () => timers.size;
  w.run = async () => { for (let i = 0; i < 20 && timers.size; i++) { const fns = [...timers.values()]; timers.clear(); for (const fn of fns) await fn(); await settle(); } await settle(); };
  return w;
}

describe('one actor per window (main.js, stubbed)', () => {
  it('a sign-in another window stored is followed once: linked here, the pending Google attempt dropped, the sheet closed', async () => {
    const w = actorWin();
    w.stored = { session: { user: { id: 'u-1' } } };
    w.look();
    await w.run();
    assert.deepEqual(w.calls.finishLink, [['u-1', true, true]]); // fresh (it says so), echo (not counted as a second sign-in)
    assert.equal(w.calls.dropTry, 1);
    assert.equal(w.calls.closeLogin, 1);
    assert.equal(w.api.who(), 'u-1');
    // Looked at again, the client's own SIGNED_IN on every refocus, a storage event: nothing more to do.
    w.look();
    w.storage(SESSION_LS);
    await w.run();
    await w.api.syncActor();
    assert.equal(w.calls.finishLink.length, 1);
    assert.equal(w.pending(), 0, 'no sync left queued: it does not loop');
  });
  it("waits for this window's own sign-in path instead of running beside it", async () => {
    const w = actorWin();
    let open = null;
    const gate = new Promise((r) => { open = r; });
    // The normal Google result: the exchange stores the session (and raises the event) before finishLink has run.
    const own = w.api.actorOp(async () => { w.stored = { session: { user: { id: 'u-1' } } }; await gate; w.api.setUser({ id: 'u-1' }); });
    await w.api.syncActor();
    w.look();
    await w.run();
    assert.deepEqual(w.calls.finishLink, [], 'the sync only noted that it was asked');
    open();
    await own;
    await w.run();
    assert.deepEqual(w.calls.finishLink, [], 'afterwards it finds this window already on that account');
    assert.equal(w.pending(), 0);
  });
  it('a sign-out in another window: this window takes the guest that window made, and makes none of its own', async () => {
    const w = actorWin({ user: 'u-1', linked: 'guest:g-old', guest: { sub: 'g-fresh', token: 't-fresh' } });
    w.stored = { session: null };
    w.look();
    await w.run();
    assert.equal(w.api.who(), '');
    assert.equal(w.net.id, 'guest:g-fresh');
    assert.deepEqual(w.calls.guestToken, []);
    assert.deepEqual(w.calls.removed.filter((k) => k === GT_LS), [], 'the other window\'s new guest is not thrown away');
    assert.deepEqual(w.calls.resendPush, [], 'the window that signed out already moved the push subscription');
    assert.deepEqual(plain(w.calls.setAccount.at(-1)), { ready: true, guest: true, linked: false });
    assert.equal(w.calls.forget, 1);
    assert.deepEqual([w.state.grants.length, w.state.pending, w.state.confirmed, w.state.walletKnown], [0, 0, 0, false]);
    assert.equal(w.calls.notes.length, 1);
    assert.match(w.calls.notes[0], /^로그아웃됐어요/);
    w.look();
    await w.run();
    assert.equal(w.calls.notes.length, 1, 'said once');
  });
  it('a sign-out nobody made a guest for (the session ended by itself): the merged guest goes and this window makes the new one', async () => {
    const w = actorWin({ user: 'u-1', linked: 'guest:g-old' });
    w.stored = { session: null };
    w.storage(SESSION_LS);
    await w.run();
    assert.deepEqual(w.calls.guestToken, [true]);
    assert.ok(w.calls.removed.includes(GT_LS));
    assert.equal(w.net.id, 'guest:g-made1');
    assert.deepEqual(plain(w.calls.resendPush), [{ force: true }]);
  });
  it('does nothing when the stored session cannot be read', async () => {
    const w = actorWin({ user: 'u-1', linked: 'guest:g-old' });
    w.stored = null;
    w.look();
    await w.run();
    assert.equal(w.api.who(), 'u-1');
    assert.equal(w.net.id, 'user:u-1');
    assert.deepEqual([w.calls.guestToken.length, w.calls.finishLink.length, w.calls.notes.length, w.calls.forget], [0, 0, 0, 0]);
  });
  it('another account in storage: this one is left first, then that one is linked', async () => {
    const w = actorWin({ user: 'u-1' });
    w.stored = { session: { user: { id: 'u-2' } } };
    w.look();
    await w.run();
    assert.equal(w.calls.forget, 1);
    assert.deepEqual(w.calls.finishLink, [['u-2', true, true]]);
    assert.equal(w.api.who(), 'u-2');
  });
  it('two guest windows play as the same stored guest', async () => {
    const w = actorWin({ guest: { sub: 'g-old', token: 't-old' } });
    w.bag.set(GT_LS, JSON.stringify({ sub: 'g-other', token: 't-other' })); // another window signed out and stored its new guest
    w.storage(GT_LS);
    await w.run();
    assert.equal(w.net.id, 'guest:g-other');
    assert.deepEqual([w.calls.guestToken.length, w.calls.notes.length, w.calls.resendPush.length], [0, 0, 0]);
    w.storage('kts_nick'); // some other key: not asked
    assert.equal(w.pending(), 0);
  });
  it("this window's own sign-out makes the new guest and moves the push subscription to it; a withdrawal does not", async () => {
    const out = actorWin({ user: 'u-1', linked: 'guest:g-old' });
    assert.equal(await out.api.becomeGuest(), true);
    assert.deepEqual(out.calls.guestToken, [true]);
    assert.equal(out.net.id, 'guest:g-made1');
    assert.deepEqual(plain(out.calls.resendPush), [{ force: true }]);
    assert.deepEqual([out.state.grants.length, out.state.pending, out.state.confirmed, out.state.walletKnown], [0, 0, 0, false]);
    const gone = actorWin({ user: 'u-1', linked: 'guest:g-old' });
    await gone.api.becomeGuest({ push: false });
    assert.deepEqual(gone.calls.resendPush, []);
  });
  it('main.js: finishLink is a no-op for the account this window already shows, so no path can merge twice', () => {
    const main = read('main.js');
    const fl = between(main, 'async function finishLink(', 'async function bootAccount(');
    assert.ok(fl.indexOf('if (sessionUser?.id === user.id) return null;') > 0);
    assert.ok(fl.indexOf('if (sessionUser?.id === user.id) return null;') < fl.indexOf('sessionUser = user;'));
    assert.ok(fl.indexOf('sessionUser = user;') < fl.indexOf('await '), 'set before the first await');
    assert.match(fl, /mergedMark !== mark/); // the kts_merged guard stays
    assert.match(fl, /sessionStorage\.setItem\('kts_merged', mark\)/);
    assert.match(fl, /if \(fresh && !echo\) trackEvent\('auth_login_success'/);
    // Every path of this window's own that changes the actor is an actorOp.
    assert.match(between(main, 'async function finishOAuth(msg) {', 'async function popupOAuth('), /await actorOp\(async \(\) => \{/);
    assert.match(between(main, 'async function passwordSign(', '\n// ---- one actor per window'), /await actorOp\(async \(\) => \{/);
    assert.match(between(main, 'async function signOutAccount() {', '\n// In-app browser: after the player was sent'), /await actorOp\(async \(\) => \{/);
    assert.match(between(main, 'async function withdrawAccount() {', '// 로그아웃'), /await actorOp\(async \(\) => \{/);
  });
});

describe('policy text', () => {
  it('exports both documents as plain text and loads without a page', () => {
    assert.equal(policyKind(), ''); // no location here
    for (const kind of ['terms', 'privacy']) {
      const d = policyDoc(kind);
      assert.ok(d.title && d.sections.length >= 5, kind);
      for (const s of d.sections) { assert.equal(typeof s.h, 'string'); assert.ok(s.p.length > 10); assert.doesNotMatch(s.h + s.p, /<[a-z]/i); }
    }
    assert.equal(policyDoc('terms').title, '이용약관');
    assert.equal(policyDoc('privacy').title, '개인정보처리방침');
    assert.equal(policyDoc('other'), null);
    assert.equal(policyDoc(), null);
  });
  it('is read inside the game: no link in ui.js opens ?policy= in another tab', () => {
    const ui = read('ui.js');
    assert.doesNotMatch(ui, /\?policy=/);
    assert.match(ui, /import \{ policyDoc \} from '\.\/legal\.js\?v=\d+'/);
    assert.match(ui, /function legalFold\(\)/);
    const login = between(ui, '  function openLogin(', '  function handoverMoved(');
    assert.doesNotMatch(login, /policyLinks\(\)/); // one set of links, not a second row at the bottom
    assert.match(login, /legal\.box\)/);
  });
  it('the full-page document closes itself when it has an opener, and only otherwise goes to the plaza', () => {
    const legal = read('legal.js');
    const back = between(legal, 'function goBack(e)', 'function article(');
    assert.match(back, /if \(!window\.opener\) return;/);
    assert.match(back, /window\.close\(\)/);
    assert.match(legal, /a\.href = '\.\/';/);
  });
});

describe('Google sign-in keeps the game tab', () => {
  const main = read('main.js'), net = read('net.js'), ui = read('ui.js');
  it('opens the window in the click itself and never navigates the game tab unless it was blocked', () => {
    assert.doesNotMatch(main, /async function startOAuth/);
    const start = between(main, '\nfunction startOAuth(provider) {', '\nasync function passwordSign(');
    assert.match(start, /window\.open\('', 'kts_oauth', 'popup,width=480,height=680'\)/);
    assert.doesNotMatch(start, /noopener|await /);
    assert.ok(start.indexOf('window.open(') < start.indexOf('popupOAuth(provider, w)'));
    assert.match(start, /if \(!w \|\| w\.closed\) \{ redirectOAuth\(provider\); return; \}/);
    assert.match(start, /isInAppWebView\(navigator\.userAgent\)\) return;/); // in-app browsers hand over instead
    const popup = between(main, 'async function popupOAuth(', 'async function redirectOAuth(');
    assert.match(popup, /net\.oauthUrl\(provider, location\.origin \+ '\/oauth'\)/);
    assert.match(popup, /w\.location = url;/);
    assert.match(popup, /\}, 500\);/); // the w.closed poll
    const blocked = between(main, 'async function redirectOAuth(', '\nfunction startOAuth(');
    assert.match(blocked, /새 창이 막혀 있어 이 화면에서 로그인합니다/);
    assert.ok(blocked.indexOf('savePlace()') >= 0 && blocked.indexOf('savePlace()') < blocked.indexOf('net.startOAuth(provider)'));
  });
  it('asks supabase-js for the address only, exchanges the code in this tab, and keeps PKCE and the full-page fallback', () => {
    assert.match(net, /async oauthUrl\(provider, redirectTo\) \{[^\n]*signInWithOAuth\(\{ provider, options: \{ redirectTo, skipBrowserRedirect: true \} \}\)/);
    assert.match(net, /async exchangeCode\(code\) \{[^\n]*exchangeCodeForSession\(code\)/);
    assert.match(net, /async startOAuth\(provider\) \{[^\n]*const redirectTo = returnUrl\(location\.href\);[^\n]*signInWithOAuth\(\{ provider, options: \{ redirectTo \} \}\)/);
    assert.match(net, /flowType: 'pkce'/);
    assert.match(net, /fetch\('\/rt\/guest'/); // guests stay Worker-signed
  });
  it('takes one result per attempt, answers it, and ignores a message when nothing is pending', () => {
    const on = between(main, 'function onOAuthMessage(data, source) {', '\ntry { oauthChan = new BroadcastChannel(OAUTH_CHANNEL)');
    assert.match(on, /const msg = oauthMessage\(data\);/);
    assert.match(on, /if \(!msg \|\| !t\) return;\s+oauthTry = null;/); // cleared before anything async: a second copy finds nothing pending
    assert.ok(on.indexOf('oauthTry = null') < on.indexOf('{ t: OAUTH_ACK }'));
    assert.match(main, /window\.addEventListener\('message', \(e\) => \{ if \(e\.origin === location\.origin\) onOAuthMessage\(e\.data, e\.source\); \}\);/);
    const fin = between(main, 'async function finishOAuth(msg) {', 'async function popupOAuth(');
    assert.match(fin, /net\.exchangeCode\(msg\.code\)/);
    assert.match(fin, /await finishLink\(session, true\)/);
    assert.match(fin, /ui\.closeLogin\?\.\(\)/);
  });
  it('reads "came back with ?code=" before net.init and never starts a sign-in from a handover link without a tap', () => {
    assert.ok(main.indexOf('const ARRIVED = oauthReturn(location.search, location.hash);') > 0);
    assert.ok(main.indexOf('const ARRIVED = oauthReturn(') < main.indexOf('const net = new Net();'));
    const boot = between(main, 'async function bootAccount() {', '\n// ---- Google sign-in in a second window');
    assert.match(boot, /finishLink\(session, ARRIVED\.code\)/);
    assert.doesNotMatch(boot, /startOAuth|oauthUrl|signInWithOAuth|window\.open/);
    assert.match(boot, /if \(resume\) ui\.openLogin\?\.\(\{ resume: true \}\);/);
    // The confirmation link of an older sign-up mail says its own line instead (mailcode.js mailArrival).
    assert.match(boot, /if \(ARRIVED\.failed && !mailSaid\) ui\.note\(oauthErrorText\(ARRIVED\), 'err'\);/);
    assert.match(boot, /cleanAddress\(location\.href\)/);
    assert.match(ui, /구글 로그인으로 이어서 연결합니다/);
    assert.match(ui, /resume \? '구글로 계속' : 'Google로 계속'/);
  });
  it('shows the waiting state on the Google button and errors as lines in the sheet, not toasts', () => {
    const login = between(ui, '  function openLogin(', '  function handoverMoved(');
    assert.match(login, /google\.disabled = !!loginView\.wait;/);
    assert.match(login, /'구글 창에서 계속하세요…'/);
    // Every message of this sheet is inline. The toasts are for results that arrive after the player closed the sheet: an id sign-in that
    // failed, and the code step (away(): a tap reopens the sheet on the code).
    assert.equal((login.match(/\bnote\(/g) || []).length, 2); assert.match(login, /if \(sheet !== me\) note\(text, 'err'\);/);
    assert.match(login, /const away = \(text, kind = 'err'\) => \{ if \(sheet !== me\) note\(text, kind, \(\) => openLogin\(\)\); \};/);
    assert.match(login, /h\('form', \{ class: 'login-form'/);
    assert.match(login, /autocomplete: 'username', autocapitalize: 'off'/);
    assert.match(login, /enterkeyhint: 'next'/);
    assert.match(login, /enterkeyhint: 'go'/);
    assert.match(login, /pw\.autocomplete = up \? 'new-password' : 'current-password';/);
    assert.match(login, /if \(e\.key === 'Enter' && !e\.isComposing\) \{ e\.preventDefault\(\); pw\.focus\(\); \}/);
    assert.match(login, /'Google로 계속하면 만 14세 이상이며 ', legal\.link\('terms', '이용약관'\), '과 ', legal\.link\('privacy', '개인정보처리방침'\), '에 동의하는 것으로 봅니다'/);
    // Order in the sheet: Google, the divider, the id form.
    const gAt = login.search(/\n\s+google,\r?\n/), orAt = login.indexOf("class: 'login-or', text: '또는'"), formAt = login.indexOf('form, swap, legal.box');
    assert.ok(gAt > 0 && gAt < orAt && orAt < formAt, [gAt, orAt, formAt].join());
  });
});

describe('account: nickname, sign-out, settings, handover, withdrawal', () => {
  const main = read('main.js'), ui = read('ui.js'), html = read('index.html');
  it('never takes the provider profile name: the nickname stays and goes to the merge', () => {
    assert.doesNotMatch(main, /profileName/);
    assert.doesNotMatch(ui, /profileName|full_name|user_metadata/);
    const fl = between(main, 'async function finishLink(', 'async function bootAccount(');
    assert.match(fl, /net\.mergeGuest\(guest\.id, guest\.token, state\.nick\)/);
    assert.doesNotMatch(fl, /state\.nick =|NICK_KEY|setName/);
  });
  it('signs out to a brand-new guest: the old guest token and the merged mark go, the account keeps its boards', () => {
    const guest = between(main, 'async function becomeGuest(', 'async function withdrawAccount() {');
    assert.match(guest, /localStorage\.removeItem\(GT_LS\)/);
    assert.match(guest, /sessionStorage\.removeItem\('kts_merged'\)/);
    assert.ok(guest.indexOf('localStorage.removeItem(GT_LS)') < guest.indexOf('guestToken(true)'));
    assert.match(guest, /await rejoin\(\);/);
    const out = between(main, 'async function signOutAccount() {', '\n// In-app browser: after the player was sent');
    assert.match(out, /await net\.signOut\(\);/);
    assert.ok(out.indexOf('net.signOut()') < out.indexOf('becomeGuest()'));
    assert.doesNotMatch(out, /withdraw/i); // no server call that removes anything
    assert.match(between(main, 'async function withdrawAccount() {', '// 로그아웃'), /await net\.withdrawAccount\(\);\s+await becomeGuest\(\{ push: false \}\);/);
    assert.match(read('net.js'), /async signOut\(\) \{[^\n]*auth\.signOut\(\{ scope: 'local' \}\)/);
  });
  it('leaves nothing of the account behind: wallet figures, the 소속 chip, the boards taken from it', () => {
    const forget = between(main, '\nfunction forgetActor() {', '\n// The new guest another window stored');
    for (const line of ['walletGen += 1;', 'state.grants = [];', 'state.pending = 0;', 'state.confirmed = 0;', 'state.walletKnown = false;', 'ui.setWallet(state);', 'ui.forgetActor?.();']) assert.ok(forget.includes(line), line);
    const guest = between(main, 'async function becomeGuest(', 'async function withdrawAccount() {');
    assert.ok(guest.indexOf('forgetActor();') > 0 && guest.indexOf('forgetActor();') < guest.indexOf('refreshWallet()'), 'before the new wallet is read');
    const gone = between(ui, '    forgetActor() {', '    promptLink,');
    assert.match(gone, /tribeBtn\.textContent = '소속';/);
    assert.match(gone, /store\('kts_taken', \[\]\);/);
    assert.match(gone, /takenWant\.length = 0;/);
  });
  it('gives a guest and a linked account a visible way in and out', () => {
    assert.match(ui, /h\('button', \{ class: 'btn gold', type: 'button', text: '계정 연결 \+300', onclick/); // the guest banner, same class
    assert.match(ui, /text: '이미 계정이 있어요 · 로그인'/); // the boot card
    assert.match(ui, /if \(bootLogin\) bootLogin\.hidden = guestWarn\.hidden;/);
    const set = between(ui, '  function openSettings() {', '  function openWithdraw() {');
    assert.match(set, /text: '계정 연결 · 로그인 \(\+300\)', onclick: \(\) => openLogin\(\)/);
    assert.match(set, /accountLabel\(hooks\.email\?\.\(\)\)/);
    assert.match(set, /응원 포인트·전광판·토지는 계정에 그대로 남고/);
    assert.match(set, /await hooks\.signOut\?\.\(\);/);
    assert.ok(set.indexOf("text: '로그아웃'") < set.indexOf('[회원 탈퇴 및 데이터 초기화]'));
    assert.match(html, /\.modal\.front \{ z-index: 60; \}/); // the sheet opens over the boot card (z-index 50)
    // Newcomer mode hides the banner, not the settings gear.
    assert.ok(html.includes('#ui.newbie .guestwarn'));
    assert.match(ui, /class: 'btn ghost icon tool-more', type: 'button', 'aria-label': '설정'/);
  });
  it('withdrawal is its own step: the list, 되돌릴 수 없어요, 취소 as the big button, and the typed word', () => {
    const w = between(ui, '  function openWithdraw() {', '\n  // ---------------------------------------------------------------- HUD readouts');
    assert.match(w, /되돌릴 수 없어요/);
    for (const item of ['계정 자체', '응원 포인트', '전광판과 토지', '소원', '알림 구독']) assert.ok(w.includes(item), item);
    assert.match(w, /class: 'btn gold cta', type: 'button', text: '취소', onclick: \(\) => openSettings\(\)/);
    assert.match(w, /text: '탈퇴하기', disabled: true/);
    assert.match(w, /if \(!typed\(\)\) return;/);
    assert.match(ui, /const WITHDRAW_WORD = '탈퇴';/);
    assert.doesNotMatch(between(ui, '  function openSettings() {', '  function openWithdraw() {'), /hooks\.withdraw/); // only the dedicated step withdraws
  });
  it('in-app browsers keep the handover: persistent text in the sheet, a wallet re-read on return', () => {
    const login = between(ui, '  function openLogin(', '  function handoverMoved(');
    assert.match(login, /if \(env\.inApp\) \{ handOver\(\); return; \}/);
    assert.match(login, /에서 이어서 진행 중이에요\. 로그인이 끝나면 그 창에서 계속하세요/);
    assert.match(login, /hooks\.handoverFired\?\.\(\);/);
    assert.match(login, /now\.routes/);
    const env = between(main, 'function authEnv() {', 'function authMessage(');
    assert.match(env, /routes: href \? externalRoutes\(ua, href\) : \[\]/);
    const back = between(main, 'async function handoverBack() {', "document.addEventListener('visibilitychange', () => {");
    assert.match(back, /await refreshWallet\(\)/);
    assert.match(back, /ui\.handoverMoved\?\.\(\)/);
    assert.match(ui, /function handoverMoved\(\)/);
  });
  it('keeps the new CSS right after the .agree rules and inside the allowed tokens and sizes', () => {
    const at = html.indexOf('.agree a, .note.legal a { color: var(--info); font-weight: 700; }');
    const block = html.slice(at, html.indexOf('.policydoc {', at));
    assert.ok(at > 0 && block.includes('.login-google') && block.includes('.legalbox') && block.includes('.acct'));
    const vars = new Set([...block.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    for (const v of vars) assert.ok(['--surface', '--surface-2', '--line', '--text', '--text-2', '--muted', '--accent', '--danger', '--info'].includes(v), v);
    for (const m of block.matchAll(/font-size: (\d+)px/g)) assert.ok(['12', '13', '15', '17'].includes(m[1]), m[0]);
    for (const m of block.matchAll(/border-radius: (\d+)px/g)) assert.ok(['10', '14'].includes(m[1]), m[0]);
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
