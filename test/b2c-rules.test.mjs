// B2C free season (2026-11-27): PERSONAL boards on the gift engine (occasion `me`), the new days 사랑 / 졸업·승진, the honest price
// ladder and its experiment arms, the account nudge's return address, and the card words that say "by" on a board of one's own.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIFT, OCCASIONS, OCC_KEYS, GIFT_PICK, ME_KINDS, TIERS, TIER_NOTE, giftFault, isMe, toLine, boardTitle, giftShareText, visitorShareText, plazaNote,
  replyDraft, replyLabel, cerBand, cerTeaser, ladderArm, armsFrom, LADDER_ARMS, giftBack, MORE_BEACONS, cpLen, kstDay,
} from '../giftrules.js';
import { wishFault } from '../wish.js';
import { cardWords, musicUrl, musicUrls, MUSIC_BACKUP } from '../realrules.js';

const NOW = Date.parse('2026-11-23T03:00:00Z'); // 12:00 KST
const day = kstDay(NOW);
const form = (o = {}) => ({ to: '민지', occ: 'me', msg: '올해는 꼭 해낸다!', day, at: 'now', ...o });

describe('PERSONAL: a board of one\'s own (occ me)', () => {
  it('is an occasion like any other, with 사랑 and 졸업·승진 added after the six that were there', () => {
    assert.deepEqual(OCC_KEYS.slice(0, 6), ['bday', 'anniv', 'pass', 'cheer', 'just', 'thanks'], 'old boards keep their keys');
    for (const k of ['love', 'grad', 'me']) assert.ok(OCCASIONS[k], k);
    assert.equal(OCCASIONS.me.name, '내 전광판'); assert.equal(OCCASIONS.love.name, '사랑'); assert.equal(OCCASIONS.grad.name, '졸업·승진');
    assert.equal(GIFT_PICK.includes('me'), false, 'the gift maker never offers 내 전광판 as a day');
    assert.deepEqual([...GIFT_PICK].sort(), OCC_KEYS.filter((k) => k !== 'me').sort());
    for (const k of OCC_KEYS) assert.ok(cpLen(OCCASIONS[k].hint) <= GIFT.msgMax && !wishFault(OCCASIONS[k].hint), k);
  });
  it('four kinds that only seed the line, each a line the board takes', () => {
    assert.deepEqual(ME_KINDS.map((x) => x.name), ['이름 걸기', '다짐', '작품·채널', '특별한 순간']);
    for (const x of ME_KINDS) { assert.ok(cpLen(x.msg) <= GIFT.msgMax, x.name); assert.equal(wishFault(x.msg), '', x.name); assert.equal(giftFault(form({ msg: x.msg }), NOW).ok, true, x.name); }
  });
  it('the name is the shown name: asked for in its own words, and a board of one\'s own has no sender', () => {
    const r = giftFault(form({ from: '누군가' }), NOW);
    assert.equal(r.ok, true); assert.equal(r.v.occ, 'me'); assert.equal(r.v.from, ''); assert.equal(r.v.th, 'night');
    const none = giftFault(form({ to: '' }), NOW);
    assert.equal(none.field, 'to'); assert.equal(none.code, 'me'); assert.match(none.error, /이름/);
    assert.equal(giftFault({ to: '', occ: 'bday', day, at: 'now' }, NOW).code, 'to', 'a gift still asks for the recipient');
    assert.equal(giftFault(form({ to: '운영자' }), NOW).code, 'name', 'the same name rules');
    assert.equal(giftFault(form({ occ: 'love', from: '나' }), NOW).v.from, '나', 'a gift keeps its sender');
  });
  it('says "by" where a gift says "To." and never calls itself a gift', () => {
    assert.equal(isMe({ occ: 'me' }), true); assert.equal(isMe({ occ: 'bday' }), false); assert.equal(isMe(null), false);
    assert.equal(toLine({ occ: 'me', to: '민지' }), 'by 민지'); assert.equal(toLine({ occ: 'bday', to: '민지' }), 'To. 민지'); assert.equal(toLine({ occ: 'bday' }), 'To. 당신');
    assert.equal(boardTitle({ occ: 'me', to: '민지' }), '민지님의 전광판'); assert.equal(boardTitle({ occ: 'bday', to: '민지' }), '민지님을 위한 선물 전광판');
    const me = { occ: 'me', to: '민지', takes: true };
    for (const t of [giftShareText(me), visitorShareText(me), { title: plazaNote(me, 'live'), text: '' }]) assert.equal(/선물|위한/.test(t.title + t.text), false, JSON.stringify(t));
    assert.match(giftShareText(me).text, /가상 광장/);
    assert.match(giftShareText({ occ: 'bday', to: '민지' }).title, /민지님을 위한 선물 전광판/, 'gifts as before');
    assert.equal(cerBand({ occ: 'me', to: '민지', a: Date.parse('2026-11-25T09:00:00Z'), day: '2026-11-25' }).startsWith('by 민지'), true);
    const t = cerTeaser({ occ: 'me', to: '민지', th: '' }, 0);
    assert.equal(t.by, 1); assert.equal(t.th, 'night');
    assert.equal('by' in cerTeaser({ occ: 'bday', to: '민지' }, 0), false, 'a gift\'s teaser keeps its fields');
  });
  it('the visitor\'s button on a board of one\'s own is a cheer for that person, not a reply', () => {
    assert.deepEqual(replyDraft({ occ: 'me', to: '민지', from: '' }), { to: '민지', from: '', occ: 'cheer', msg: '', th: '' });
    assert.equal(replyLabel({ occ: 'me', to: '민지' }), '📣 민지님에게 응원 전광판 걸기');
    assert.equal(replyLabel({ occ: 'bday', to: '민지', from: '지수' }), '💌 지수님에게 답장 전광판 걸기');
  });
});

describe('the real video\'s card and music for the new days', () => {
  it('a board of one\'s own says by, with no From.', () => {
    const w = cardWords({ occ: 'me', to: '민지', from: '누군가', msg: '' });
    assert.equal(w.to, 'by 민지'); assert.equal(w.from, ''); assert.equal(w.key, 'me'); assert.equal(w.line, OCCASIONS.me.hint);
    assert.equal(cardWords({ occ: 'love', to: '민지' }).to, 'To. 민지');
  });
  it('a day whose own track is not in yet plays a declared stand-in, then the birthday song', () => {
    assert.equal(musicUrl('love'), '/assets/plates/music-love.m4a', 'its own file first');
    for (const k of Object.keys(MUSIC_BACKUP)) { assert.ok(OCCASIONS[k], k); assert.ok(OCCASIONS[MUSIC_BACKUP[k]] && !MUSIC_BACKUP[MUSIC_BACKUP[k]], k + ' stands in with a day that has its own'); }
    assert.deepEqual(musicUrls('love'), ['/assets/plates/music-love.m4a', '/assets/plates/music-' + MUSIC_BACKUP.love + '.m4a']);
    assert.deepEqual(musicUrls('bday'), ['/assets/plates/music-bday.m4a']);
    assert.deepEqual(musicUrls('zzz'), ['/assets/plates/music-bday.m4a']);
  });
});

describe('the honest ladder (E1) and its arms', () => {
  const said = JSON.stringify(TIERS);
  it('promises nothing the code cannot do: no 24 hours on a big screen, no 30-day or 1-year pages, no parade, no photo download', () => {
    for (const w of ['24시간', '30일', '1년', '퍼레이드', '내려받기', '사진', '큰 화면']) assert.equal(said.includes(w), false, w);
  });
  it('free says what is there now; every paid tier is labelled as what comes once payment opens', () => {
    assert.equal(TIERS[0].price, 0); assert.equal(TIERS[0].label || '', '');
    assert.match(TIERS[0].items.join(' '), /6시간/); assert.match(TIERS[0].items.join(' '), /메인 타워 축하 1분/); assert.match(TIERS[0].items.join(' '), /실사 축하 영상/);
    for (const t of TIERS.slice(1)) assert.equal(t.label, '결제가 열리면', t.name);
    assert.match(said, /AI 합성/, 'the AI mark stays on the clean real video');
    assert.match(TIER_NOTE, /부가세 포함/);
  });
  it('one arm (A) at the planned prices unless GIFT_ARMS names more; a bad spec falls back to A', () => {
    assert.deepEqual(LADDER_ARMS.A, TIERS.map((t) => t.price));
    assert.deepEqual(ladderArm('abcd1234', ''), { a: 'A', p: [0, 3900, 7900, 14900] });
    assert.deepEqual(armsFrom('A:3900/7900/14900;B:2900/5900/11900'), { A: [0, 3900, 7900, 14900], B: [0, 2900, 5900, 11900] });
    for (const bad of ['B:1/2', 'a:3900/7900/14900', 'B:9000/7900/14900', 'B:0/1/2', 'junk', 'B:3900/7900/99999999']) assert.deepEqual(armsFrom(bad), { A: LADDER_ARMS.A }, bad);
    const spec = 'A:3900/7900/14900;B:2900/5900/11900', seen = new Set();
    for (const id of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee', 'ffffffff', '00000001', '00000002']) {
      const x = ladderArm(id, spec); seen.add(x.a); assert.deepEqual(x, ladderArm(id, spec), 'the same board always gets the same arm');
    }
    assert.deepEqual([...seen].sort(), ['A', 'B']);
  });
});

describe('the account nudge', () => {
  it('comes back only to a board page', () => {
    assert.equal(giftBack('/g/abcd1234'), '/g/abcd1234');
    for (const v of ['', null, '/g/abcd', 'https://x.example/g/abcd1234', '//x.example/g/abcd1234', '/g/abcd1234/../x', '/g/ABCD1234', '/gift']) assert.equal(giftBack(v), '', String(v));
  });
  it('its beacons and the card save are page beacons', () => {
    assert.deepEqual([...MORE_BEACONS].sort(), ['card_save', 'signup_from_gift', 'signup_nudge']);
  });
});
