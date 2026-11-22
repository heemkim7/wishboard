// The screens and texts of the coin and account round (2026-11-22): the visit-statistics opt-out (analytics.js, index.html), the policy and
// terms (legal.js), the id sign-up warning and password change, the re-join notice, and what a sign-out clears. Run code where it can run in
// node, pin the source where it cannot.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i + a.length, j); };

describe('방문 통계 보내지 않기', () => {
  const html = read('index.html');
  const src = (html.match(/<script>\s*(const GA_MEASUREMENT_ID[\s\S]*?)<\/script>/) || [])[1] || '';
  // The tag script itself with a made-up browser: what it adds to the page.
  const page = ({ stored = null, gpc, noStorage = false } = {}) => {
    const window = {}, tags = [];
    const ctx = { window, location: { search: '' }, document: { createElement: () => ({}), head: { appendChild: (s) => tags.push(s.src) } }, setInterval: () => 0, clearInterval() {} };
    if (!noStorage) ctx.localStorage = { getItem: (k) => (k === 'kts_stats_off' ? stored : null) };
    if (gpc !== undefined) ctx.navigator = { globalPrivacyControl: gpc };
    runInNewContext(src, ctx);
    return { window, tags };
  };
  it('index.html adds no Google tag and no dataLayer when the setting is on or the browser sends GPC; otherwise as before', () => {
    assert.ok(src.length > 100);
    const on = page({ stored: '1' }), gpc = page({ gpc: true });
    for (const p of [on, gpc]) { assert.deepEqual(p.tags, []); assert.equal(p.window.dataLayer, undefined); assert.equal(p.window.gtag, undefined); assert.equal(p.window['ga-disable-G-ZHXT5BEQ4J'], true); }
    for (const p of [page(), page({ stored: '0', gpc: false }), page({ noStorage: true })]) { assert.equal(p.tags.length, 1); assert.match(p.tags[0], /googletagmanager\.com\/gtag\/js\?id=G-/); assert.equal(typeof p.window.gtag, 'function'); }
    assert.equal(page().window.KTS_GA_ID, 'G-ZHXT5BEQ4J');
  });
  it('analytics.js uses the same key, sends no gtag event while off, and stops a tag that is already on the page', async () => {
    assert.match(read('analytics.js'), /export const STATS_OFF_KEY = 'kts_stats_off';/);
    assert.ok(src.includes("localStorage.getItem('kts_stats_off') === '1'"));
    const bag = new Map(), sent = [];
    globalThis.localStorage = { getItem: (k) => (bag.has(k) ? bag.get(k) : null), setItem: (k, v) => bag.set(k, String(v)), removeItem: (k) => bag.delete(k) };
    globalThis.window = { gtag: (...a) => sent.push(a[1]), KTS_GA_ID: 'G-TEST1234' };
    const A = await import('../analytics.js');
    try {
      assert.equal(A.statsOff(), false); A.trackEvent('wish_cheer', { slot: 'STREET_1' }); assert.deepEqual(sent, ['wish_cheer']);
      assert.equal(A.setStatsOff(true), true); assert.equal(bag.get('kts_stats_off'), '1'); assert.equal(window['ga-disable-G-TEST1234'], true);
      A.trackEvent('wish_cheer', { slot: 'STREET_1' }); assert.deepEqual(sent, ['wish_cheer']); // nothing more to Google
      assert.equal(A.setStatsOff(false), false); assert.equal(bag.has('kts_stats_off'), false); assert.equal(window['ga-disable-G-TEST1234'], false);
      A.trackEvent('wish_cheer'); assert.equal(sent.length, 2);
      const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      Object.defineProperty(globalThis, 'navigator', { value: { globalPrivacyControl: true }, configurable: true, writable: true });
      try {
        assert.equal(A.statsGpc(), true); assert.equal(A.statsOff(), true); assert.equal(A.setStatsOff(false), true); // GPC keeps it off
        A.trackEvent('wish_cheer'); assert.equal(sent.length, 2);
      } finally { if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; }
    } finally { delete globalThis.window; delete globalThis.localStorage; }
  });
  it('the settings sheet has the switch, and GPC shows it ticked and fixed', () => {
    const ui = read('ui.js'), f = between(ui, '  function statsField() {', '\n  }\n');
    assert.match(ui, /import \{ trackEvent, statsOff, statsGpc, setStatsOff \} from '\.\/analytics\.js\?v=\d+';/);
    assert.match(f, /checked: statsOff\(\), disabled: gpc/); assert.match(f, /'방문 통계 보내지 않기'/); assert.match(f, /setStatsOff\(box\.checked\)/);
    assert.match(between(ui, '  function openSettings() {', '\n  // 회원 탈퇴'), /\n\s+statsField\(\),\n/);
  });
});

describe('개인정보처리방침과 이용약관', () => {
  const legal = read('legal.js'), privacy = between(legal, 'function privacy()', 'function terms()'), terms = between(legal, 'function terms()', '// { title, sections');
  it('says what a Google sign-in stores, that GA is on from the start, and how to turn it off', () => {
    assert.doesNotMatch(legal, /실명은 수집하지 않습니다/);
    assert.match(privacy, /구글로 로그인하면 구글이 알려 주는 이메일, 프로필 이름, 프로필 사진 주소가 로그인 정보\(Supabase Auth\)에 함께 저장됩니다/);
    assert.match(privacy, /게임에는 직접 정한 닉네임만 보입니다/);
    assert.match(privacy, /따로 묻지 않고 처음부터 켜져 있습니다/); assert.match(privacy, /설정의 ‘방문 통계 보내지 않기’를 켜면 그 브라우저에서는 Google 애널리틱스를 불러오지 않고/); assert.match(privacy, /Global Privacy Control/);
  });
  it('the terms say that a withdrawal deletes the login too, the send floor, and the id password', () => {
    const quit = between(terms, "{ h: '탈퇴', p: '", "' },");
    assert.match(quit, /로그인 정보\(계정, 연결된 소셜 로그인, 로그인 세션\)도 지웁니다/);
    assert.doesNotMatch(quit, /지갑 연결과 전광판·토지 소유만 지우고/);
    assert.match(quit, /시작 코인과 연결 보상은 다시 주지 않습니다/);
    assert.match(terms, /계정만 할 수 있고, 처음 받은 400코인\(시작 100 \+ 연결 보상 300\)보다 더 모은 만큼만 보낼 수 있습니다/);
    assert.match(terms, /아이디로 만든 계정은 비밀번호를 잊으면 되찾을 수 없습니다/);
    assert.equal(/Google/.test(terms), false);
  });
  it('both carry the 2026-11-22 date', async () => {
    const { policyDoc } = await import('../legal.js');
    for (const kind of ['privacy', 'terms']) { const last = policyDoc(kind).sections.at(-1); assert.equal(last.h, '시행일'); assert.match(last.p, /2026년 11월 22일/); assert.match(last.p, /2026-11-22/); }
  });
});

describe('account screens of this round', () => {
  const ui = read('ui.js'), main = read('main.js'), net = read('net.js');
  it('the id sign-up says a forgotten password cannot be recovered, only while signing up', () => {
    const login = between(ui, '  function openLogin(opts) {', '\n  // In-app browser, back from the system browser');
    assert.match(login, /const idWarn = h\('p', \{ class: 'note', hidden: true, text: '아이디로 만든 계정은 비밀번호를 잊으면 되찾을 수 없어요\. 구글로 연결하면 그럴 걱정이 없어요\.' \}\);/);
    assert.match(login, /idWarn\.hidden = !up;/);
    assert.match(login, /id, pw, agreeRow, idWarn, formErr, submit/);
  });
  it('an id sign-in error after the sheet was closed is a toast', () => {
    const login = between(ui, '  function openLogin(opts) {', '\n  // In-app browser, back from the system browser');
    assert.match(login, /fail\(text\);\n\s+if \(sheet !== me\) note\(text, 'err'\);/);
  });
  it('a password account can change its password on its session: no new key, Supabase updateUser', async () => {
    assert.match(net, /async changePassword\(password\) \{ const auth = this\.sb\?\.auth; if \(!auth\?\.updateUser\) throw new Error\('로그인 준비 중이에요'\); const \{ error \} = await auth\.updateUser\(\{ password: String\(password \|\| ''\) \}\); if \(error\) throw error; \}/);
    assert.match(main, /passwordAccount: \(\) => !!sessionUser && \(sessionUser\.app_metadata\?\.provider === 'email' \|\| \/@id\\\.wishboard\\\.dev\$\/i\.test\(sessionUser\.email \|\| ''\)\),/);
    assert.match(main, /changePassword: async \(password\) => \{ try \{ await net\.changePassword\(password\); \} catch \(e\) \{ throw new Error\(authMessage\(e\)\); \} \},/);
    assert.match(between(ui, '  function openSettings() {', '\n  // 회원 탈퇴'), /if \(hooks\.passwordAccount\?\.\(\)\) account\.append\(passwordFold\(\)\);/);
    const fold = between(ui, '  function passwordFold() {', '\n  function openSettings() {');
    assert.match(fold, /if \(pw\.value !== pw2\.value\) \{ fail\('두 비밀번호가 달라요'\)/); assert.match(fold, /await hooks\.changePassword\?\.\(pw\.value\);/);
    const { authErrorText } = await import('../plaza-account.js');
    assert.equal(authErrorText({ code: 'same_password', message: 'New password should be different from the old password.' }), '지금 비밀번호와 같아요. 다른 비밀번호를 적어 주세요.');
    assert.equal(authErrorText({ code: 'reauthentication_needed', message: 'x' }), '보안을 위해 로그아웃한 뒤 다시 로그인하고 바꿔 주세요.');
    assert.equal(authErrorText({ code: 'weak_password', message: 'Password should be at least 6 characters.' }), '비밀번호는 6자 이상이어야 해요');
  });
  it('a re-join after a withdrawal is told once, from the link answer', () => {
    const fl = between(main, 'async function finishLink(', 'async function bootAccount(');
    assert.match(fl, /else if \(merged\?\.again\) ui\.note\('계정을 연결했어요\. 예전에 탈퇴한 계정이라 시작 코인과 연결 보상은 다시 붙지 않아요', 'ok'\);/);
    assert.match(read('worker.js'), /\.\.\.\(again \? \{ again: true \} : \{\}\) \}\);/);
  });
  it('a sign-out or withdrawal clears 받은 소식 and its 🔔: main.js drops the rows, ui.js hides the button and closes an open list', () => {
    const fa = between(main, '\nfunction forgetActor() {', '\n}');
    assert.match(fa, /inboxRows = \[\]; inboxHandled = new Set\(\); liveNews = \[\];/); assert.match(fa, /ui\.setInboxDot\?\.\(false\);/);
    const uf = between(ui, '    forgetActor() {', '\n    },');
    assert.match(uf, /inboxBtn\.hidden = true;/); assert.match(uf, /if \(sheet\?\.inbox\) closeSheet\(\);/);
    assert.match(between(ui, '  function openInboxSheet() {', '\n  }\n'), /sheet\.inbox = true;/);
  });
  it('the wallet sheet says the send floor before the player taps', () => {
    assert.match(ui, /hooks\.isGuest\?\.\(\) \? '손님은 코인을 보낼 수 없어요\. 계정을 연결하면 처음 받은 400코인\(시작 100 \+ 연결 보상 300\)보다 더 모은 만큼 보낼 수 있어요\.' : '처음 받은 400코인\(시작 100 \+ 연결 보상 300\)보다 더 모은 만큼만 보낼 수 있어요\.'/);
  });
});
