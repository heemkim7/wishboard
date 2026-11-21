// Shares that lead back into the game, push offered at the right moment, and the "다녀간 사이" sheet.
// Pure decisions live in ftue.js / share.js / push.js; source checks only where a browser is needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  pushAsk, PUSH_BACKOFF, PUSH_WHY, awayRows, AWAY_MAX, inboxUnread, seenAdd, present, msgText, shareWish, wishBootLine, startFtue,
} from '../ftue.js';
import { snapQuery, vipShareLink, dropParams, DEEP_KEYS, cardUrl } from '../share.js';
import { resendPush, PUSH_DONE } from '../push.js';
import { applyInboxPush } from '../inbox.js';
import { proofOffers } from '../overlay.js';
import { EVENT_NAMES } from '../plaza-account.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-21T03:00:00Z');
const DAY = '2026-11-21';
const ago = (ms) => new Date(NOW - ms).toISOString();

describe('push offer decision', () => {
  const base = { supported: true, permission: 'default', offered: false, dismissedAt: 0, now: NOW, busy: false, newbie: false };
  it('opens when the browser can and nothing was asked', () => {
    assert.equal(pushAsk(base), 'open');
  });
  it('never when permission is decided or the browser cannot', () => {
    assert.equal(pushAsk({ ...base, permission: 'denied' }), 'no');
    assert.equal(pushAsk({ ...base, permission: 'granted' }), 'no');
    assert.equal(pushAsk({ ...base, supported: false }), 'no');
    assert.equal(pushAsk({}), 'no');
  });
  it('once per session, and never for newcomers', () => {
    assert.equal(pushAsk({ ...base, offered: true }), 'no');
    assert.equal(pushAsk({ ...base, newbie: true }), 'no');
  });
  it('waits 3 days after the sheet was closed without subscribing', () => {
    assert.equal(PUSH_BACKOFF, 3 * 864e5);
    assert.equal(pushAsk({ ...base, dismissedAt: NOW - 3600e3 }), 'no');
    assert.equal(pushAsk({ ...base, dismissedAt: NOW - PUSH_BACKOFF + 1000 }), 'no');
    assert.equal(pushAsk({ ...base, dismissedAt: NOW - PUSH_BACKOFF - 1000 }), 'open');
    assert.equal(pushAsk({ ...base, dismissedAt: 'junk' }), 'open');
  });
  it('queues while another sheet is up', () => {
    assert.equal(pushAsk({ ...base, busy: true }), 'wait');
    assert.equal(pushAsk({ ...base, busy: true, permission: 'granted' }), 'no');
  });
  it('has a context line for each moment and says what will arrive', () => {
    assert.equal(PUSH_WHY.wish, '하트가 오면 바로 알려 드릴까요?');
    assert.equal(PUSH_WHY.claim, '빼앗기면 바로 알려 드릴까요?');
    assert.ok(PUSH_WHY.share);
    assert.match(PUSH_DONE, /전광판을 빼앗기거나 내 소원에 하트가 오면 알려 드려요\./);
  });
  // The claim moment no longer opens the push sheet: its ask is the "알림 받기" button on the proof bar (test/overlay.test.mjs
  // proofOffers), and showing that button is this session's offer.
  it('ui.js wires the share and wish moments through queuePushOffer, the claim moment through the proof bar, and stores the back-off', () => {
    const ui = read('ui.js');
    assert.equal(/queuePushOffer\('claim'\)/.test(ui), false);
    assert.match(ui, /proofPush\.hidden = !offers\.push;/);
    assert.match(ui, /if \(offers\.push\) \{\s*pushQueued = false;\s*pushOffered = true;/);
    assert.match(ui, /if \(postedFresh\) queuePushOffer\('wish'\)/);
    assert.match(ui, /function askShot\(\) \{\s*queuePushOffer\(\);/);
    assert.match(ui, /store\(PUSH_ASK_KEY, Date\.now\(\)\)/);
    assert.match(ui, /const PUSH_ASK_KEY = 'kts_push_ask';/);
  });
});

describe('push re-send', () => {
  const sub = { toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }) };
  const nav = (s) => ({ serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => s } }) } });
  const session = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  it('posts the existing subscription once per session with the actor token', async () => {
    const calls = [];
    const env = { Notification: { permission: 'granted' }, navigator: nav(sub), session: session(), token: 'tok1', fetch: async (u, o) => { calls.push([u, o]); return { ok: true }; } };
    assert.equal(await resendPush(env), true);
    assert.equal(await resendPush(env), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/rt/push');
    assert.equal(calls[0][1].method, 'POST');
    assert.equal(calls[0][1].headers.authorization, 'Bearer tok1');
    assert.deepEqual(JSON.parse(calls[0][1].body), { s: sub.toJSON() });
  });
  it('does nothing without permission, a service worker, or a subscription', async () => {
    let n = 0;
    const fetch = async () => { n++; return { ok: true }; };
    assert.equal(await resendPush({ Notification: { permission: 'default' }, navigator: nav(sub), session: session(), token: 't', fetch }), false);
    assert.equal(await resendPush({ Notification: undefined, navigator: nav(sub), session: session(), token: 't', fetch }), false);
    assert.equal(await resendPush({ Notification: { permission: 'granted' }, navigator: {}, session: session(), token: 't', fetch }), false);
    assert.equal(await resendPush({ Notification: { permission: 'granted' }, navigator: nav(null), session: session(), token: 't', fetch }), false);
    assert.equal(n, 0);
  });
  it('push.js takes the token from doToken like profile.js, with the stored guest as fallback', () => {
    const src = read('push.js');
    assert.match(src, /const \{ doToken \} = await import\('\.\/net\.js(\?v=[0-9a-z]+)?'\);/);
    assert.match(src, /localStorage\.getItem\('masil_gt'\)/);
    assert.match(src, /authorization: 'Bearer ' \+ await bearer\(\)/);
    assert.match(read('main.js'), /ui\.resendPush\?\.\(\);/);
  });
});

describe('다녀간 사이 rows', () => {
  const inbox = [
    { id: 9, kind: 'taken', slot_id: 'STREET_8', from_name: '하늘', created_at: ago(60e3) },
    { id: 8, kind: 'cheer', slot_id: 'STREET_8', phrase: 1, from_name: '민지', created_at: ago(120e3) },
    { id: 7, kind: 'reply', slot_id: 'STREET_8', phrase: 2, from_name: '준호', created_at: ago(180e3) },
    { id: 6, kind: 'tribe', created_at: ago(200e3) },
    { id: 5, kind: 'taken', slot_id: 'STREET_9', from_name: '옛날', created_at: ago(9 * 864e5) },
  ];
  const wish = { mine: { id: 'abcdefghij', hearts: 7 }, yesterday: [{ id: 'zzzzzzzzzz', rank: 2, prize: 200, mine: true, txt: '합격' }] };
  const args = { inbox, seen: [], copy: applyInboxPush, wish, wishSeen: { id: 'abcdefghij', hearts: 4 }, prizeDay: '', day: DAY, now: NOW };
  it('newest first, one action per row, old and slot-less rows left out', () => {
    const { rows, inboxIds } = awayRows(args);
    assert.deepEqual(rows.map((r) => r.kind), ['wish', 'taken', 'look', 'look', 'prize']);
    assert.equal(rows[1].text, applyInboxPush(inbox[0]));
    assert.equal(rows[1].label, '되찾으러 가기');
    assert.equal(rows[1].slot, 'STREET_8');
    assert.equal(rows[2].label, '보러가기');
    assert.deepEqual(inboxIds, [9, 8, 7]);
  });
  it('counts only the hearts since the last look, and remembers the new count', () => {
    const { rows, wishSeen } = awayRows(args);
    assert.equal(rows[0].text, '내 소원에 하트가 3개 늘었어요 (지금 7개)');
    assert.equal(rows[0].label, '내 소원 보기');
    assert.deepEqual(wishSeen, { id: 'abcdefghij', hearts: 7 });
    assert.equal(awayRows({ ...args, wishSeen: { id: 'abcdefghij', hearts: 7 } }).rows.some((r) => r.kind === 'wish'), false);
    assert.equal(awayRows({ ...args, wishSeen: { id: 'otherwish0', hearts: 50 } }).rows[0].text, '내 소원에 하트가 7개 늘었어요 (지금 7개)');
  });
  it('shows yesterday\'s prize once a day', () => {
    const first = awayRows(args);
    const prize = first.rows.find((r) => r.kind === 'prize');
    assert.equal(prize.text, '어제 소원이 2위였어요. +200코인');
    assert.equal(first.prizeDay, DAY);
    assert.equal(awayRows({ ...args, prizeDay: DAY }).rows.some((r) => r.kind === 'prize'), false);
    assert.equal(awayRows({ ...args, wish: { mine: null, yesterday: wish.yesterday } }).rows.find((r) => r.kind === 'prize').label, '오늘 소원 걸기');
  });
  it('at most 6 rows; seen inbox rows are skipped', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, kind: 'taken', slot_id: 'STREET_' + (i + 1), from_name: 'x', created_at: ago(i * 1000) }));
    const out = awayRows({ ...args, inbox: many });
    assert.equal(out.rows.length, AWAY_MAX);
    assert.equal(awayRows({ ...args, seen: [9, 8, 7] }).rows.some((r) => r.kind === 'taken' || r.kind === 'look'), false);
  });
  it('newcomers get nothing, and nothing qualifies means no rows', () => {
    assert.deepEqual(awayRows({ ...args, newbie: true }).rows, []);
    const empty = awayRows({ inbox: [], wish: { mine: { id: 'abcdefghij', hearts: 0 }, yesterday: [] }, day: DAY, now: NOW });
    assert.deepEqual(empty, { rows: [], inboxIds: [], wishSeen: null, prizeDay: '' });
  });
  it('the 🔔 count and the seen list', () => {
    assert.equal(inboxUnread(inbox, [], NOW), 4);
    assert.equal(inboxUnread(inbox, [9, 8], NOW), 2);
    assert.deepEqual(seenAdd([1, 2], [2, 3, 'x']), [1, 2, 3]);
    assert.equal(seenAdd(Array.from({ length: 70 }, (_, i) => i + 1), [100]).length, 60);
  });
  it('main.js marks the shown rows read on close and drops the plain-text line', () => {
    const main = read('main.js');
    assert.equal(main.includes('showAwayInbox'), false);
    const fn = main.slice(main.indexOf('async function showAway()'), main.indexOf('async function pullProfile()'));
    // What is read on close now comes from overlay.js awayRead (everything on an explicit close, only the rows acted on otherwise).
    assert.match(fn, /const read = awayRead\(plan, how\?\.acted, how\?\.explicit !== false\);/);
    assert.match(fn, /readInbox\(read\.inboxIds\)/);
    assert.match(fn, /ui\.openAway\?\.\(plan\.rows,/);
    assert.match(fn, /if \(WISH_ID && !FOCUS\) await/);
    const ui = read('ui.js');
    assert.match(ui, /if \(newbieOn \|\| Date\.now\(\) - awayWant\.at > 120000\) \{ awayWant = null; return false; \}/);
    assert.match(ui, /class: 'btn icon tool-inbox'/);
    assert.match(read('index.html'), /#ui\.newbie \.tools \.tool-inbox \{ display: none !important; \}/);
  });
});

describe('share links', () => {
  it('snapshot query: slot, else wish, else nothing', () => {
    assert.equal(snapQuery({ slot: 'STREET_8' }), '?slot=STREET_8');
    assert.equal(snapQuery({ wish: 'abcdefghij' }), '?wish=abcdefghij');
    assert.equal(snapQuery({ slot: 'MAIN_TOP', wish: 'abcdefghij' }), '?slot=MAIN_TOP');
    assert.equal(snapQuery({ slot: 'NOPE' }), '');
    assert.equal(snapQuery({ wish: 'ABC' }), '');
    assert.equal(snapQuery(), '');
    assert.match(read('net.js'), /fetch\('\/rt\/snap' \+ snapQuery\(ctx\)/);
    assert.match(read('net.js'), /return \{ url: String\(data\.url\), page:/);
  });
  it('VIP link: my wish, else a lit board of mine, else the site', () => {
    const boards = [
      { slot_id: 'STREET_3', holder_id: 'guest:me', lit_until: new Date(NOW - 1000).toISOString() },
      { slot_id: 'STREET_8', holder_id: 'guest:me', lit_until: new Date(NOW + 864e5).toISOString() },
      { slot_id: 'MAIN_TOP', holder_id: 'guest:you', lit_until: new Date(NOW + 864e5).toISOString() },
    ];
    const o = 'https://x.test';
    assert.deepEqual(vipShareLink({ origin: o, wish: { id: 'abcdefghij' }, boards, me: 'guest:me', now: NOW }), { kind: 'wish', url: 'https://x.test/rt/w/abcdefghij' });
    assert.deepEqual(vipShareLink({ origin: o, wish: { id: 'abcdefghij', hidden: true }, boards, me: 'guest:me', now: NOW }), { kind: 'board', url: cardUrl('STREET_8') });
    assert.deepEqual(vipShareLink({ origin: o + '/', boards, me: 'guest:you2', now: NOW }), { kind: 'site', url: 'https://x.test/' });
    assert.deepEqual(vipShareLink({ origin: o, boards, me: '', now: NOW }).kind, 'site');
  });
  it('the VIP bonus is asked only after the link really went out', () => {
    const ui = read('ui.js');
    const vip = ui.slice(ui.indexOf('function openVip()'), ui.indexOf("const redeem = h('button'"));
    assert.ok(vip.indexOf("if (how !== 'shared' && how !== 'copied')") > 0);
    assert.ok(vip.indexOf("if (how !== 'shared' && how !== 'copied')") < vip.indexOf('hooks.shareBonus?.()'));
    assert.equal(vip.includes('navigator.clipboard.writeText'), false);
  });
  it('used deep-link params leave the address bar, others stay', () => {
    assert.deepEqual([...DEEP_KEYS], ['focus', 'gift', 'ref', 'tribe']);
    assert.equal(dropParams('https://x.test/?focus=STREET_8&gift=1&ref=ab12cd34&q=hi#k'), '/?q=hi#k');
    assert.equal(dropParams('https://x.test/?tribe=abcd1234', ['tribe']), '/');
    assert.equal(dropParams('https://x.test/?q=1&focus=A', ['tribe']), '');
    assert.equal(dropParams('not a url'), '');
    const main = read('main.js');
    assert.match(main, /dropDeep\(\['focus', 'gift', 'ref'\]\);/);
    assert.match(main, /dropDeep\(\['tribe'\]\);/);
  });
  it('manual-copy fallback order: share sheet (only when asked), clipboard, then the box', async () => {
    const data = { text: 'hi', url: 'https://x.test/rt/s/0' };
    assert.equal(await shareWish({ nav: null, clip: async () => true, data }), 'copied');
    assert.equal(await shareWish({ nav: null, clip: async () => false, data }), 'manual');
    assert.equal(await shareWish({ nav: { share: async () => {} }, clip: async () => false, data }), 'shared');
    const ui = read('ui.js');
    const send = ui.slice(ui.indexOf('async function sendLink('), ui.indexOf('function manualCopy('));
    assert.match(send, /shareWish\(\{ nav: native \? navigator : null, clip: writeClip/);
    assert.match(send, /if \(how === 'manual'\) showManual\(/);
    assert.match(send, /trackEvent\('share_link', \{ kind, how:/);
    assert.match(ui, /'길게 눌러 복사하세요'/);
    // invite, tribe, wish and VIP all go through sendLink; no link lands in a toast.
    for (const kind of ['invite', 'tribe', 'wish', 'vip', 'shot']) assert.ok(ui.includes(`sendLink({ kind: '${kind}'`), kind);
    assert.equal(/note\(line, 'err'\)|note\(href, 'ok'\)|note\(imageUrl\)/.test(ui), false);
    assert.ok(EVENT_NAMES.includes('share_link'));
  });
  it('the photo share copies the preview page with the share text, never the raw JPEG', () => {
    const ui = read('ui.js');
    const shot = ui.slice(ui.indexOf('async function openShot('), ui.indexOf('async function sendLink('));
    assert.match(shot, /text: '공유 링크 복사'/);
    assert.match(shot, /sendLink\(\{ kind: 'shot', text: SHARE_TEXT, url: page/);
    assert.match(shot, /hooks\.publishShot\?\.\(blob, slot \? \{ slot \} : undefined\)/);
    assert.equal(/imageUrl|r\.url|\.url\b(?!:)/.test(shot.replace(/url: page/g, '').replace(/URL\.createObjectURL|URL\.revokeObjectURL/g, '')), false);
    assert.match(shot, /공유 링크를 만들지 못했어요\. 이미지를 저장해서 보내 주세요\./);
  });
  it('the wish share tries a picture link with a 4 s cap and one upload at a time', () => {
    const ui = read('ui.js');
    assert.match(ui, /hooks\.pinWish\?\.\(id\);[^\n]*\n\s*await new Promise\(\(r\) => setTimeout\(r, 900\)\);/);
    assert.match(ui, /hooks\.publishShot\?\.\(shot \|\| blob, \{ wish: id \}\)/);
    assert.match(ui, /setTimeout\(\(\) => r\(''\), 4000\)/);
    assert.match(ui, /'전광판에 올리는 중…'/);
    assert.match(ui, /const WISH_PIC_MS = 10 \* 60000;/);
    assert.match(read('main.js'), /pinWish: \(id\) => world\?\.pinWish\?\.\(id\)/);
  });
});

describe('wish sheet: no "null" text (S4/C1)', () => {
  it('present() drops null, undefined, false and empty strings, keeps nodes and text', () => {
    const a = { nodeType: 1 };
    assert.deepEqual(present(a, null, undefined, false, '', 'x', [a, null, [false, 'y']]), [a, 'x', a, 'y']);
    assert.deepEqual(present(), []);
  });
  it('msgText() turns a missing message into an empty line', () => {
    assert.equal(msgText(null), '');
    assert.equal(msgText(undefined), '');
    assert.equal(msgText(false), '');
    assert.equal(msgText(0), '0');
    assert.equal(msgText('하트'), '하트');
  });
  it('every replaceChildren in the wish code goes through fill()', () => {
    const ui = read('ui.js');
    const sheet = ui.slice(ui.indexOf('// ---------------------------------------------------------------- 오늘의 소원'), ui.indexOf('function openAd(slotId)'));
    assert.match(sheet, /const fill = \(el, \.\.\.nodes\) => \{ el\.replaceChildren\(\.\.\.present\(nodes\)\); return el; \};/);
    assert.equal(sheet.split('.replaceChildren(').length - 1, 1, 'only fill() calls replaceChildren');
    assert.match(sheet, /errEl\.textContent = msgText\(text\)/);
  });
});

describe('wish UI review fixes', () => {
  it('I4: the boot card offers a heart only for today\'s wish and without ?focus=', () => {
    const deep = { id: 'abcdefghij', nick: '민지', txt: '합격', hearts: 2, day: DAY };
    assert.equal(wishBootLine({ deep, day: DAY }).enter, '입장해서 하트 보내기');
    assert.equal(wishBootLine({ deep, day: DAY, focus: true }).enter, '');
    const old = wishBootLine({ deep: { ...deep, day: '2026-11-19' }, day: DAY });
    assert.equal(old.kind, 'deep');
    assert.equal(old.enter, '');
    assert.equal(wishBootLine({ deep: { ...deep, day: '' }, day: DAY }).enter, '입장해서 하트 보내기');
  });
  it('I5: with no walk after the bake pay, the tutorial ends right after the goal line', () => {
    const calls = [];
    startFtue({
      ui: { setNextLine: (t) => calls.push(['line', t]), tutorial: (ev) => calls.push(['tut', ev]), nextGoal: () => ({ free: false, name: '메인거리', left: 20 }) },
      world: { setWaypoint: () => {}, boardView: () => ({ holder_id: 'x' }), slotCard: () => null },
    }).onBakePay();
    assert.deepEqual(calls.slice(-2), [['line', '메인거리까지 20코인 더 모으면 걸 수 있어요'], ['tut', 'walkDone']]);
    const walk = [];
    startFtue({
      ui: { setNextLine: () => {}, tutorial: (ev) => walk.push(ev) },
      world: { setWaypoint: () => {}, boardView: (id) => (id === 'STREET_11' ? {} : { holder_id: 'x' }), slotCard: (id) => (id === 'STREET_11' ? { x: 1, z: 2 } : null) },
    }).onBakePay();
    assert.deepEqual(walk, [], 'a walk still ends it later');
  });
  it('I1/M1/M2/M3: the wish GET has a timeout; loads share a promise only per id; misses are cached; a new day goes unknown', () => {
    const net = read('net.js');
    assert.match(net, /AbortSignal\.timeout\(8000\)/);
    assert.match(net, /setTimeout\(\(\) => c\.abort\(\), 8000\)/);
    const main = read('main.js');
    const fn = main.slice(main.indexOf('let wishLoad = null'), main.indexOf('function patchWish('));
    assert.match(fn, /if \(wishLoad && !force && wishLoadId === id\) return wishLoad;/);
    assert.match(fn, /if \(before\) await before\.catch/);
    assert.match(fn, /w\.miss === id/);
    assert.match(fn, /w\.day === kstDay\(\)/);
    assert.match(main, /w\.miss = w\.focus \? '' : id;/);
    const ui = read('ui.js');
    assert.match(ui, /'없어졌거나 가려진 소원이에요'/);
    assert.match(ui, /'목록을 불러오지 못했어요\. 잠시 뒤 다시 열어 주세요\.'/);
  });
  it('I2/I3/M4/M7: pending hearts, in-place rank line, armed report and skip-on-explicit-close survive repaints', () => {
    const ui = read('ui.js');
    const sheet = ui.slice(ui.indexOf('function openWish(opts = {})'), ui.indexOf('function openAd(slotId)'));
    assert.match(sheet, /const pending = new Set\(\);/);
    assert.match(sheet, /disabled: !st\.ok \|\| busy/);
    assert.equal(/wishView\.left = |wishView\.given = /.test(sheet), false, 'the optimistic heart never writes the server copy');
    assert.equal(/wishView\.count\]\.join/.test(sheet), false, 'the count is not in the my-wish signature');
    assert.match(sheet, /rankEl\.textContent = line/);
    assert.match(sheet, /if \(manualLink\)/);
    assert.match(sheet, /armed === w\.id \? '한 번 더 누르면 신고' : '신고'/);
    assert.match(sheet, /removed\.has\(w\.id\)/);
    assert.match(sheet, /if \(!replacingSheet && !wishView\.mine && !wishSkipped\)/);
    assert.match(sheet, /'aria-label': st\.ok \? `\$\{who\}님의 소원에 하트 보내기`/);
    assert.equal(/'aria-live': 'polite'/.test(sheet), false);
  });
});

describe('final fix pass', () => {
  it('1: away rows skip boards I hold now, keep one row per kind+slot, and skip rows already seen live', async () => {
    const { awayRows: rowsOf, liveKey, liveSeenAdd } = await import('../ftue.js');
    const inbox = [
      { id: 21, kind: 'taken', slot_id: 'STREET_8', from_name: 'A', created_at: ago(60e3) },
      { id: 20, kind: 'taken', slot_id: 'STREET_8', from_name: 'B', created_at: ago(120e3) },
      { id: 19, kind: 'taken', slot_id: 'STREET_9', from_name: 'C', created_at: ago(180e3) },
      { id: 18, kind: 'cheer', slot_id: 'STREET_7', phrase: 1, from_name: 'D', created_at: ago(30 * 60e3) },
    ];
    const base = { inbox, seen: [], copy: applyInboxPush, wish: null, day: DAY, now: NOW, me: 'guest:me' };
    const all = rowsOf({ ...base, holder: () => 'guest:other' });
    assert.deepEqual(all.rows.map((r) => r.id), [21, 19, 18]);
    assert.deepEqual(all.inboxIds.sort(), [18, 19, 20, 21], 'a duplicate is marked read with the row it folded into');
    const back = rowsOf({ ...base, holder: (slot) => (slot === 'STREET_8' ? 'guest:me' : 'guest:other') });
    assert.deepEqual(back.rows.map((r) => r.id), [19, 18]);
    assert.ok(back.inboxIds.includes(21) && back.inboxIds.includes(20), 'handled rows are marked read too');
    const key = liveKey({ kind: 'cheer', slot_id: 'STREET_7' }, NOW - 30 * 60e3 + 90e3);
    assert.equal(key, 'cheer|STREET_7|' + Math.floor((NOW - 30 * 60e3 + 90e3) / 1000));
    const live = rowsOf({ ...base, holder: () => '', liveSeen: [key] });
    assert.deepEqual(live.rows.map((r) => r.id), [21, 19]);
    assert.ok(live.inboxIds.includes(18));
    assert.equal(rowsOf({ ...base, holder: () => '', liveSeen: [liveKey({ kind: 'cheer', slot_id: 'STREET_7' }, NOW - 20 * 60e3)] }).rows.length, 3, 'outside the window it still shows');
    assert.equal(liveSeenAdd(Array.from({ length: 40 }, (_, i) => 'k' + i), 'new').length, 30);
    assert.equal(liveSeenAdd(['a'], '').length, 1);
  });
  it('2/3: the photo upload is capped at 15 s and share buttons are guarded while busy', () => {
    const ui = read('ui.js');
    const shot = ui.slice(ui.indexOf('async function openShot('), ui.indexOf('function manualCopy('));
    assert.match(shot, /setTimeout\(\(\) => r\(null\), 15000\)/);
    assert.match(shot, /if \(shareBusy\) return/);
    assert.match(ui, /if \(shareBusy\) return 'busy';/);
  });
  it('4: wish caption layout wraps to two lines, shrinks to fit, never splits a surrogate pair', async () => {
    const { wrapLine, wishCaption } = await import('../share.js');
    const measure = (s, size) => Array.from(s).length * size * 0.9;
    assert.deepEqual(wrapLine('가나다라마바사', 4 * 9, (s) => measure(s, 10), 2), ['가나다라', '마바사']);
    const cut = wrapLine('가나다라마바사아자차카타', 4 * 9, (s) => measure(s, 10), 2);
    assert.equal(cut.length, 2);
    assert.ok(cut[1].endsWith('…'));
    for (const l of wrapLine('😀😀😀😀😀😀😀😀😀', 3 * 9, (s) => measure(s, 10), 2)) assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(l), false);
    const c = wishCaption({ w: 1280, h: 720, text: '올해는 꼭 합격', nick: '민지', measure });
    assert.equal(c.head.text, '🌠 오늘의 소원');
    assert.equal(c.by.text, '— 민지');
    assert.equal(c.lines.length, 1);
    assert.ok(c.panel.y >= 0 && c.panel.y + c.panel.h <= 720 / 3 + 1);
    assert.ok(c.lines[0].y > c.head.y && c.by.y > c.lines[0].y && c.by.y < c.panel.y + c.panel.h);
    const long = wishCaption({ w: 400, h: 720, text: '가'.repeat(24), nick: '', measure });
    assert.ok(long.lines.length <= 2);
    assert.ok(long.size < wishCaption({ w: 400, h: 720, text: '가', nick: '', measure }).size, 'shrinks to fit');
    assert.equal(long.by.text, '— 누군가');
    for (const l of long.lines) assert.ok(measure(l.text, long.size) <= long.maxW + 0.001);
    const ui = read('ui.js');
    assert.match(ui, /composeWishShot\(blob, \{ text: m\.txt, nick: m\.nick \}\)/);
    assert.equal(/innerHTML/.test(read('share.js')), false);
  });
  it('5/6: a queued offer expires, replacing is not dismissing, no claim offer after a gift; the inline offer in the wish card', () => {
    const base = { supported: true, permission: 'default', offered: false, dismissedAt: 0, now: NOW };
    assert.equal(pushAsk({ ...base, queuedAt: NOW - 61e3 }), 'no');
    assert.equal(pushAsk({ ...base, queuedAt: NOW - 30e3 }), 'open');
    assert.equal(pushAsk({ ...base, placement: 'inline', newbie: true, busy: true }), 'open');
    assert.equal(pushAsk({ ...base, placement: 'inline', permission: undefined }), 'no');
    assert.equal(pushAsk({ ...base, placement: 'inline', offered: true }), 'no');
    assert.equal(pushAsk({ ...base, placement: 'inline', dismissedAt: NOW - 1000 }), 'no');
    const ui = read('ui.js');
    assert.match(ui, /if \(offer && !done && !replacingSheet\) store\(PUSH_ASK_KEY, Date\.now\(\)\)/);
    // No claim offer after a gift or a plot: that rule is proofOffers now (the bar's push button is hidden for both).
    assert.equal(proofOffers({ pushSupported: true, permission: 'default', gift: '민지', slot: 'STREET_8' }).push, false);
    assert.equal(proofOffers({ pushSupported: true, permission: 'default', gift: '', slot: 'PLOT_2' }).push, false);
    assert.equal(proofOffers({ pushSupported: true, permission: 'default', gift: '', slot: 'STREET_8' }).push, true);
    assert.match(ui, /'🔔 하트가 오면 바로 알려 드릴까요\?'/);
    assert.match(ui, /text: '알림 켜기'/);
  });
  it('7: the away sheet waits while the player is busy and expires after 2 minutes', () => {
    const ui = read('ui.js');
    const fn = ui.slice(ui.indexOf('function maybeAway()'), ui.indexOf('function pumpQueued()'));
    assert.match(fn, /Date\.now\(\) - awayWant\.at > 120000/);
    assert.match(fn, /loungeWatch/);
    assert.match(fn, /baking \|\| dance \|\| driving/);
  });
  it('8: gift copy fallback, tribe param after success, midnight reload, iOS selection', () => {
    assert.equal(applyInboxPush({ kind: 'gift' }), '누군가님이 전광판을 선물했어요');
    const main = read('main.js');
    const fn = main.slice(main.indexOf('async function joinTribeLink()'), main.indexOf('async function refreshWallet()'));
    assert.ok(fn.indexOf("dropDeep(['tribe'])") > fn.indexOf("net.authed('/rt/tribe', { id })"));
    const ui = read('ui.js');
    assert.match(ui, /out\.setSelectionRange\(0, out\.value\.length\)/);
    assert.match(ui, /if \(!wishView\.known && wasKnown\)/);
  });
});
