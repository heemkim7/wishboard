// The non-game WISH BOARD (2026-11-23, docs/non-game-plan-2026-11-22.md): what the terms and the privacy policy promise, and the page
// titles, meta, manifest and sign-in window that no longer call the service a game. An AI draft of the legal text, not a lawyer's:
// docs/grac-inquiry.md carries the lawyer's checklist. The rest of the game wording is listed in docs/wording-sweep.md.
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { policyDoc } from '../legal.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const sec = (kind, h) => policyDoc(kind).sections.find((s) => s.h === h)?.p || '';
const GAME = /점령|땅따먹|K-점령전|게임|코인|플레이|붕어빵|빼앗|추첨|복권|로또/;

describe('terms of the non-game service', () => {
  it('say what the service is, that it is not a game, and that it is not the real Times Square', () => {
    const s = sec('terms', '서비스');
    assert.match(s, /^WISH BOARD\(모두의 전광판\)는 뉴욕 타임스퀘어를 본뜬 3D 가상 광장/);
    for (const w of ['선물 전광판', '롤링페이퍼', '응원 팀', '명당', '이 서비스는 게임이 아닙니다', '보상이 없습니다', '정해진 리액션만', '실제 타임스퀘어와 그곳의 건물·단체·광고와는 관계가 없습니다']) assert.ok(s.includes(w), w);
  });
  it('응원 포인트: earned without play, never sold, never sent, no cash value, taken back for abuse', () => {
    const p = sec('terms', '응원 포인트');
    for (const w of ['출석', '공유', '전광판 구경과 응원', '하트', '친구 초대', '계정 연결', '조작하는 놀이나 추첨으로는 주지 않습니다', '응원 포인트를 돈을 받고 팔지 않습니다',
      '다른 사람에게 보내거나 넘길 수 없고', '현금 가치가 없으므로', '돈이나 다른 재산을 받고 사고팔거나 빌려줄 수 없고', '그 포인트를 거두거나']) assert.ok(p.includes(w), w);
    assert.equal(sec('terms', '코인'), '');
    // 2026-11-27: the wish ranking prize and the sponsor code are gone; the terms say no points come from hearts, the ranking or a code
    for (const w of ['소원 순위(어제의 소원)로는 포인트를 주지 않고', '하트 하나마다 주는 포인트도 없습니다', '코드를 넣어 받는 포인트도 없습니다']) assert.ok(p.includes(w), w);
    for (const w of ['300, 200, 100', '10,000', '스폰서 코드', '⑨', '⑩']) assert.equal(p.includes(w), false, w);
    // 메인 타워 축하 1분 (2026-11-27 설계): one place points are spent on the tower, one share reward, both with their numbers
    for (const w of ['메인 타워 축하 1분(2,000)', '응원 팀 응원과 응원 팀 명당에는 쓰지 않습니다']) assert.ok(p.includes(w), w);
    // 공유 보상 (owner, 2026-11-27): a link friend on gift pages, wish links and board links; account vs guest; steps 10 / 30; one network a day
    for (const w of ['내 링크로 온 친구가 반응하면', '내 소원 링크를 열고 그 소원이 걸린 날(한국 시간) 안에', '내 전광판 링크를 열고 24시간 안에', '한 사람은 연결이 바뀌어도 하루 한 번', '1~10번째 친구는 계정이면 50', '11~30번째 친구는 계정이면 20',
      '손님이면 몇 번째든 10', '31번째부터는 주지 않습니다', '하루 900까지', '하루 한 번만 친구로 세고', '내 계정과, 내가 만들거나 걸거나 링크를 공유한 인터넷 연결', '링크 미리보기 같은 자동 접속']) assert.ok(p.includes(w), w);
    for (const w of ['하루 5명까지', '50(하루 5명']) assert.equal(p.includes(w), false, w);
    assert.ok(p.includes('하트나 응원 수가 아니라') && p.indexOf('하트나 응원 수가 아니라') < p.indexOf('하트 하나마다 주는 포인트도 없습니다'), 'the share reward counts friends, said before the no-points-per-heart line');
    assert.ok(p.includes('이 공유 보상 말고는 내 소원이나 전광판이 받은 하트와 응원'), 'the link-friend exception to "hearts and cheers give no points" is explicit');
  });
  it('prime screens are never sold and no payment counts toward them', () => {
    const p = sec('terms', '명당과 전광판');
    assert.match(p, /^명당\(메인 타워와 큰 화면\)은 돈으로 팔지 않습니다\./);
    assert.match(p, /어떤 유료 결제도 응원 포인트, 응원 목표, 팀 순위, 참여율 계산에 들어가지 않습니다/);
    assert.match(p, /추첨으로 정하지 않습니다/);
    assert.match(p, /메인 타워 축하 1분은 응원 포인트 2,000이나 친구 응원 10곳으로, 남은 자리에서 먼저 고른 사람이 갖습니다/); assert.match(p, /누가 어떤 방법으로 올렸는지는 보이지 않습니다/);
    assert.match(p, /하루 30자리/); assert.match(p, /정각과 밤 9시대는 응원 팀의 자리입니다/);
  });
  it('gift boards keep the recipient to a name, and the keepsake lasts seven days after the day', () => {
    const p = sec('terms', '선물 전광판과 롤링페이퍼');
    assert.match(p, /연락처는 적지 않습니다/); assert.match(p, /그날이 지나고 7일 동안/);
  });
  it('the 실사 축하 영상 is said to be an AI composite of a virtual scene, not a real broadcast', () => {
    assert.match(sec('terms', '선물 전광판과 롤링페이퍼'), /실사 축하 영상은 AI로 만든 가상의 장면에 전광판을 합성한 영상이고, 실제 타임스퀘어에서 송출한 영상이 아닙니다\./);
  });
  it('content rules: consent for photos, idol names as cheer labels only, nothing of theirs in paid products, reports', () => {
    const p = sec('terms', '게시물');
    for (const w of ['찍힌 사람의 동의를 받은 사진만', '승인한 것만', '응원 라벨로 쓸 수 있습니다', '소속사의 로고와 공식 이미지', '유료 상품에는 넣지 않습니다', '팬아트', '신고 버튼', '권리자가 요청하면']) assert.ok(p.includes(w), w);
  });
  it('paid products are marked as not open, one-off, VAT included, with a free trial; refunds and minors are plain', () => {
    const paid = sec('terms', '유료 상품(준비 중)'), refund = sec('terms', '유료 상품의 취소와 환불');
    for (const w of ['지금은 유료 상품을 팔지 않습니다', '부가가치세를 포함한 최종 가격', '자동으로 갱신되는 정기 결제는 없습니다', '뽑기', '워터마크', '영구 보관을 약속하지 않습니다', '만 14세 미만']) assert.ok(paid.includes(w), w);
    for (const w of ['간단히 말하면', '7일이 지났더라도 낸 금액을 모두 돌려드립니다', '제17조제2항제5호', '같은 조 제6항', '아직 제공되지 않은 날', '1시간 넘게', '3개월 안에', '3영업일 안에', '연 15%', '민법 제5조', '30일 전에 알리고']) assert.ok(refund.includes(w), w);
    const heads = policyDoc('terms').sections.map((s) => s.h);
    assert.ok(heads.indexOf('유료 상품(준비 중)') + 1 === heads.indexOf('유료 상품의 취소와 환불'));
  });
  it('carry no game wording outside the sentences that say it is gone', () => {
    const t = policyDoc('terms');
    for (const s of t.sections) {
      if (s.h === '시행일') continue; // the revision note names what changed
      const p = s.p.replace('이 서비스는 게임이 아닙니다', '').replace('조작하는 놀이나 추첨으로는 주지 않습니다', '').replace(/추첨으로 정하지 않습니다|놀이, 추첨, 확률로/g, '').replace('다른 사람의 전광판을 포인트로 빼앗는 기능은 없습니다', '');
      assert.equal(GAME.test(p), false, s.h + ': ' + (p.match(GAME) || [])[0]);
    }
  });
});

describe('privacy policy of the non-game service', () => {
  it('says what a gift board and its rolling paper keep, for how long, and that no email is asked', () => {
    const g = sec('privacy', '선물 전광판과 롤링페이퍼'), n = sec('privacy', '알림');
    for (const w of ['계정 번호 또는 손님 번호', '연락처가 아닌 화면에 보일 이름', '전화번호, 이메일, 주소는 받지 않습니다', '쓴 사람의 닉네임', '링크를 받은 사람은 누구나', 'Cloudflare R2', '그날이 지나고 7일 뒤에 지웁니다', '합계로만']) assert.ok(g.includes(w), w);
    for (const w of ['푸시 구독 정보', '열리면 알림', '광고성 정보', '(광고)', '밤 9시부터 다음 날 아침 8시까지는 보내지 않습니다', '이메일을 받지 않습니다', '60일']) assert.ok(n.includes(w), w);
    // 메인 타워 축하 1분: the friends' networks (a hash, per board) and the bookings
    assert.match(sec('privacy', '선물 전광판과 롤링페이퍼'), /하트를 누르거나 메시지를 남긴 인터넷 연결의 해시/);
    // 실사 축하 영상: made on the device, never uploaded
    assert.match(sec('privacy', '선물 전광판과 롤링페이퍼'), /실사 축하 영상은 이용자의 기기 안에서 만들어지고, 서버로 보내거나 저장하지 않습니다\./);
    assert.match(sec('privacy', '선물 전광판과 롤링페이퍼'), /메인 타워 축하 1분을 고르면/); assert.match(sec('privacy', '선물 전광판과 롤링페이퍼'), /31일 동안/);
    // 공유 보상 (2026-11-27): the network records it keeps, why, and how long; only the count is shown
    const s = sec('privacy', '선물 전광판과 롤링페이퍼');
    for (const w of ['소원 링크나 전광판 링크를 연 인터넷 연결의 해시', '이틀 동안', '마지막으로 쓴 날부터 30일', '8일 동안', '7일 동안', '다른 이용자에게는 친구 수만',
      '어느 곳(선물 전광판, 소원, 전광판)의 무엇', '센 시각', '반응한 사람의 계정 번호나 손님 번호(토큰 없이 누른 하트는 그 기기의 해시)', '쿠키(kts_via)', '하루 동안', '광장에서 하트나 응원을 보낼 때']) assert.ok(s.includes(w), w);
  });
  it('names every processor the code uses, where it keeps data, and how to refuse', () => {
    const x = sec('privacy', '처리 위탁과 국외 이전');
    for (const w of ['Cloudflare, Inc.(미국', 'Turnstile', 'Supabase Pte. Ltd.(싱가포르', '대한민국(서울)', 'Google LLC(미국', 'Google 애널리틱스', '네트워크를 통해', '보유 기간', '회원 탈퇴', '방문 통계 보내지 않기', 'jsDelivr']) assert.ok(x.includes(w), w);
    const heads = policyDoc('privacy').sections.map((s) => s.h);
    assert.ok(heads.indexOf('광고 문의') < heads.indexOf('처리 위탁과 국외 이전') && heads.indexOf('처리 위탁과 국외 이전') < heads.indexOf('이용자의 권리'), heads.join(','));
    assert.equal(heads.at(-1), '시행일');
  });
  it('speaks of the plaza, not a game', () => {
    for (const s of policyDoc('privacy').sections) if (s.h !== '시행일') assert.equal(/게임|코인|점령/.test(s.p), false, s.h);
  });
});

describe('pages, meta and manifest no longer call it a game', () => {
  const html = read('index.html');
  const meta = (attr, name) => { const m = html.match(new RegExp(`<meta\\s+${attr}="${name.replace(/[:.]/g, '\\$&')}"\\s+content="([^"]*)"`)); return m ? m[1] : null; };
  it('index.html: description, Open Graph, Twitter, JSON-LD and the boot card', () => {
    const vals = [meta('name', 'description'), meta('property', 'og:description'), meta('property', 'og:image:alt'), meta('name', 'twitter:description'), meta('name', 'twitter:image:alt')];
    for (const v of vals) { assert.ok(v); assert.equal(GAME.test(v), false, v); }
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
    assert.notEqual(ld.applicationCategory, 'GameApplication'); assert.equal(GAME.test(ld.description), false);
    const boot = html.slice(html.indexOf('<div id="boot"'), html.indexOf('</div>\n</div>', html.indexOf('<div id="boot"')));
    assert.ok(boot.length > 100); assert.equal(GAME.test(boot.replace(/<[^>]+>/g, ' ')), false);
    assert.match(meta('property', 'og:description'), /가상 타임스퀘어/); // not to be read as the real square
  });
  it('the share pages, the share text and the manifest say the same', () => {
    const og = meta('property', 'og:description');
    assert.ok(read('worker.js').includes(`desc: '${og}'`));
    assert.ok(read('ui.js').includes(`const SHARE_TEXT = '${og}';`));
    const m = JSON.parse(read('manifest.webmanifest'));
    assert.equal(m.description, og); assert.equal(m.categories.includes('games'), false);
  });
  it('the sign-in window, the admin title and the ad pages', () => {
    assert.equal(/게임/.test(read('oauth.html').replace(/\/\/.*$/gm, '')), false);
    assert.match(read('admin.html'), /<title>사진 전광판 검수 · WISH BOARD<\/title>/);
    for (const f of ['ads.html', 'adspage.js']) assert.equal(/게임|코인|점령/.test(read(f).replace(/\/\/.*$/gm, '')), false, f);
    assert.equal(read('adsale.js').match(/export const AD_COUNTED = '([^']+)'/)[1], '광장이 센 수');
  });
});
