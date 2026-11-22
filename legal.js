// Policy documents. policyDoc(kind) is the text: the plaza unfolds it inside its own sheets (ui.js), so reading it never leaves the game.
// A direct ?policy= load still paints the full-page document. This module has no game imports so it can paint before the plaza loads
// (opsrules.js is plain text rules, shared with the Worker, so it is imported without a query).
import { operatorLine, operatorOf } from './opsrules.js';
const CONTACT = 'Wishboard 운영자';
// The operator's details from /rt/config (Worker var OPERATOR_INFO). Until then, or without them, the documents point at 문의하기.
let OP = null;
export function setOperator(op) { OP = operatorOf(op); return OP; }
export const operatorInfo = () => OP;
const ASK = '문의는 설정의 문의하기로 해 주세요.';
// 전자상거래법 시행령 제11조의4: a 사이버몰 names its hosting provider. The site and its Worker run on Cloudflare (wrangler.jsonc).
const HOST = '이 사이트의 호스팅 서비스는 Cloudflare, Inc.가 제공합니다.';
const who = () => OP?.name || CONTACT;
// One date for both documents. A revision changes the date and the note in brackets (test/coins-client.test.mjs pins the date).
// 2026-11-23: the non-game WISH BOARD (docs/non-game-plan-2026-11-22.md). An AI draft, not a lawyer's text: docs/grac-inquiry.md ends
// with the lawyer's checklist. It describes the service after the conversion, so it ships with that work, not before it.
const EFFECTIVE = '2026년 11월 23일부터 적용합니다(개정 2026-11-23: 게임 요소를 없앤 응원·선물 서비스로 바꾸면서 코인을 응원 포인트로 바꾸고, 선물 전광판과 롤링페이퍼, 게시물 규칙, 준비 중인 유료 상품의 환불과 미성년자 규정, 선물 전광판과 알림의 개인정보, 처리 위탁과 국외 이전을 더함).';

export function policyKind() {
  if (typeof location === 'undefined') return '';
  const k = new URLSearchParams(location.search).get('policy');
  return k === 'privacy' || k === 'terms' ? k : '';
}

function el(tag, text) {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
}

// Opened from another page of ours (it has an opener): the link closes this window and the player is back where they were.
// Opened by itself: it goes to the plaza.
function goBack(e) {
  if (!window.opener) return;
  e.preventDefault();
  try { window.close(); } catch { /* not ours to close */ }
  setTimeout(() => { if (!window.closed) location.href = './'; }, 400);
}

function article(doc) {
  const art = el('article');
  art.append(el('h1', doc.title));
  const back = el('p');
  const a = el('a', '광장으로 돌아가기');
  a.href = './';
  a.addEventListener('click', goBack);
  back.append(a);
  art.append(back);
  for (const s of doc.sections) art.append(el('h2', s.h), el('p', s.p));
  return art;
}

// The processors below were read from the code on 2026-11-23: wrangler.jsonc (Workers, Durable Objects, rate limits; observability on),
// human.js (Turnstile), net.js and ops.js (Supabase, project yxddhpacuyaffaoutxjn; Seoul region per AGENTS.md), index.html (GA4 on,
// Microsoft Clarity present but CLARITY_ID empty, so not listed; fonts and supabase-js from cdn.jsdelivr.net), share.js (the Kakao SDK
// loads only with KAKAO_JS_KEY, which is not set, so not listed). Entity names and privacy contacts are from each company's own
// privacy page or terms as read that day. R2 is named only for the gift-board videos, and only when that store is switched on.
// Not confirmed: where Durable Objects and an R2 bucket physically sit, and how long Workers Logs keep a request (docs/grac-inquiry.md).
function privacy() {
  return { title: '개인정보처리방침', sections: [
    { h: '수집하는 항목', p: '계정 연결 시 이메일 또는 소셜 로그인 식별자, 닉네임, 서비스 이용 기록과 접속 기록을 수집합니다. 구글로 로그인하면 구글이 알려 주는 이메일, 프로필 이름, 프로필 사진 주소가 로그인 정보(Supabase Auth)에 함께 저장됩니다. 이 이름과 사진은 광장 화면에 쓰지 않고, 광장에는 직접 정한 닉네임만 보입니다. 아이디로 가입하면 아이디와 비밀번호(되돌릴 수 없게 바꾼 값)만 저장합니다. 전화번호는 수집하지 않습니다. 게스트로 들어오면 그 브라우저에 손님 번호를 만들어 두고, 광장에 있는 동안 닉네임, 캐릭터와 옷 색, 광장 안의 위치를 같은 광장에 있는 다른 사람에게 보냅니다.' },
    { h: '이용 목적', p: '계정 식별, 응원 포인트와 전광판의 유지, 선물 전광판과 롤링페이퍼 제공, 알림, 부정 이용 방지를 위해 사용합니다. 유료 상품을 열면 결제 확인과 환불에도 사용합니다.' },
    { h: '선물 전광판과 롤링페이퍼', p: '선물 전광판을 만들면 만든 사람의 계정 번호 또는 손님 번호, 받는 사람을 부를 이름(연락처가 아닌 화면에 보일 이름), 날짜, 축하 문구와 고른 꾸미기를 저장합니다. 받는 사람의 전화번호, 이메일, 주소는 받지 않습니다. 롤링페이퍼에 메시지를 남기면 그 메시지와 쓴 사람의 닉네임, 계정 번호 또는 손님 번호를 저장합니다. 계정 번호와 손님 번호는 다른 이용자에게 보여 주지 않고, 부정 이용을 막고 신고를 처리하는 데만 씁니다. 선물 전광판과 롤링페이퍼는 정한 날 광장의 화면에 보이고, 링크를 받은 사람은 누구나 기념 페이지에서 볼 수 있습니다. 공개되어도 괜찮은 내용만 적어 주세요. 축하 영상을 서버에 저장하는 기능이 켜져 있으면 그 영상 파일을 Cloudflare R2에 저장합니다. 무료 선물 전광판의 기념 페이지, 롤링페이퍼 메시지, 저장한 영상은 그날이 지나고 7일 뒤에 지웁니다. 나중에 보관 기간이 더 긴 유료 상품을 사면 그 상품에 적힌 기간 동안 보관합니다. 유료 상품 안내에서 관심 버튼을 누른 수는 계정이나 손님 번호와 연결하지 않은 합계로만 셉니다.' },
    { h: '알림', p: '알림을 켜면 브라우저가 주는 푸시 구독 정보(알림을 받을 주소와 암호화 키)를 계정 번호 또는 손님 번호와 함께 저장하고, 내 전광판과 소원, 선물 전광판의 소식을 알림으로 보냅니다. 알림은 브라우저 회사의 푸시 서비스(예: Google, Mozilla, Apple)를 거쳐 암호화된 채 전달됩니다. 유료 상품 안내에서 ‘열리면 알림’을 누르면 유료 상품이 열릴 때 알려 드리려고 같은 푸시 구독을 씁니다. 이 알림은 광고성 정보라서 누를 때 따로 동의를 받고, 알림 앞에 (광고)를 붙이며, 밤 9시부터 다음 날 아침 8시까지는 보내지 않습니다. 이 버전은 이메일을 받지 않습니다. 푸시 구독은 알림을 끄거나 회원 탈퇴를 하면 지우고, 푸시 서비스가 없어진 구독이라고 알려 오면 지우며, 60일 동안 다시 등록되지 않은 구독은 정리합니다.' },
    { h: '보유 기간', p: `회원 탈퇴 시 삭제합니다. 탈퇴하면 그 계정의 지갑 연결과 그 계정이 가진 전광판·토지 소유를 지웁니다. 로그인 정보(이메일 또는 소셜 로그인 식별자)는 탈퇴와 함께 지웁니다. 탈퇴 화면에서 자동으로 지워지지 않는다고 안내한 경우에는 운영자가 확인한 뒤 지우며, ${CONTACT}에게 요청하면 지웁니다. 탈퇴한 뒤에는 연결 보상이 다시 지급되는 것을 막으려고, 계정으로 되돌릴 수 없는 값(계정 식별자와 이메일을 각각 해시한 값)만 보관합니다.` },
    { h: '방문 통계 (Google 애널리틱스)', p: '방문자 수와 이용 흐름을 보려고 Google 애널리틱스를 씁니다. 따로 묻지 않고 처음부터 켜져 있습니다. 설정의 ‘방문 통계 보내지 않기’를 켜면 그 브라우저에서는 Google 애널리틱스를 불러오지 않고, 브라우저가 개인정보 보호 신호(Global Privacy Control)를 보내도 불러오지 않습니다. 켜져 있을 때 사이트를 열면 브라우저가 페이지 주소와 제목, 들어온 경로, 기기와 브라우저 종류, 화면 크기, 언어, 광장에서 쓴 기능의 이름을 Google 서버(국외)로 보내고, Google은 IP 주소로 대략의 지역을 추정합니다. 방문을 구분하려고 이름이 _ga로 시작하는 쿠키를 브라우저에 저장합니다. 이메일, 닉네임, 소원 글, 선물 전광판의 문구와 받는 사람 이름, 롤링페이퍼 메시지, 사진은 Google로 보내지 않습니다. 이 통계는 계정과 연결하지 않아서 회원 탈퇴로 지워지지 않습니다. Google 애널리틱스의 보관 기간은 이벤트 기록 2개월, 방문자 식별값 14개월로 설정되어 있고, 합산한 통계는 그 뒤에도 남습니다. 브라우저에서 쿠키를 지우거나 막을 수 있고, Google의 차단 부가 기능(https://tools.google.com/dlpage/gaoptout)을 설치하면 수집되지 않습니다.' },
    { h: '문의하기', p: '설정의 문의하기로 보낸 분류와 내용, 계정 번호, 닉네임, 기기 종류(휴대폰·태블릿·컴퓨터), 서비스 버전, 보낸 화면의 경로를 저장합니다. 답장 받을 이메일은 적은 경우에만 저장하고 그 문의의 답장에만 씁니다. 문의에 답하고 문제를 고치려고 씁니다. 처리한 문의는 처리한 뒤 1년 안에 지우고, 보관은 최근 500건까지입니다. 같은 곳에서 너무 많이 보내는 것을 막으려고 접속 주소(IP)를 되돌릴 수 없게 바꾼 값을 1시간 동안 둡니다.' },
    { h: '오류 기록', p: '광장 화면에 오류가 나면 오류 문구, 오류가 난 파일과 줄, 서비스 버전, 페이지 경로, 그래픽 품질, 터치 화면인지, 브라우저와 운영체제 종류를 운영 서버로 보냅니다. 계정 번호, 닉네임, 이메일, 주소의 검색어는 보내지 않습니다. 같은 오류끼리 묶어 최근 300종류만 남기고, 운영자가 고친 뒤 지웁니다.' },
    AD_PRIVACY,
    { h: '처리 위탁과 국외 이전', p: '운영자는 서비스를 운영하려고 아래 회사에 개인정보 처리를 맡깁니다. 국외에 있는 회사로는 이용자가 서비스를 쓸 때마다 네트워크를 통해 개인정보가 옮겨지고, 옮겨지는 항목과 보유 기간은 이 방침의 각 항목에 적은 것과 같습니다(맡긴 일이 끝나거나 맡긴 계약이 끝나면 지웁니다). ① Cloudflare, Inc.(미국, dpo@cloudflare.com): 사이트 전송과 호스팅, 실시간 광장 연결, 소원·선물 전광판·롤링페이퍼·알림 구독·공유 사진·문의·오류 기록·광고 신청서 저장, 축하 영상 파일 저장(그 기능이 켜진 경우), 자동 가입을 막는 사람 확인(Turnstile), 접속 기록. 처리 장소는 미국을 비롯해 Cloudflare가 데이터센터를 둔 여러 나라입니다. ② Supabase Pte. Ltd.(싱가포르, privacy@supabase.com): 계정과 로그인 정보, 응원 포인트와 전광판 기록, 사진 전광판의 사진, 신고, 알림 구독 사본 저장. 데이터는 대한민국(서울) 지역에 저장합니다. ③ Google LLC(미국, https://support.google.com/policies): 방문 통계(Google 애널리틱스). 구글로 로그인할 때는 이용자가 구글에 직접 로그인하고, 구글이 위 ‘수집하는 항목’의 로그인 정보를 Supabase에 알려 줍니다. 국외 이전을 원하지 않으면 서비스를 이용하지 않거나 회원 탈퇴를 할 수 있고, 이 경우 서비스를 이용할 수 없습니다. 방문 통계는 설정의 ‘방문 통계 보내지 않기’로 막을 수 있고, 막아도 서비스는 그대로 이용할 수 있습니다. 글꼴과 로그인 프로그램은 공개 배포망 jsDelivr에서 불러오며, 이때 브라우저가 IP 주소와 브라우저 정보를 그 배포망에 보냅니다.' },
    { h: '이용자의 권리', p: '자신의 개인정보를 열람하거나, 고치거나 지워 달라고, 또는 처리를 멈춰 달라고 요청할 수 있습니다. 계정 정보는 설정에서 볼 수 있고, 설정에 있는 회원 탈퇴로 삭제를 요청할 수 있습니다. 그 밖의 요청은 설정의 문의하기로 하면 운영자가 확인한 뒤 10일 안에 답합니다. 만 14세 미만은 계정을 만들 수 없습니다.' },
    { h: '개인정보 문의', p: OP ? `개인정보 문의는 ${who()}에게 합니다. ${operatorLine(OP)}. ${ASK}` : `개인정보 문의는 ${CONTACT}에게 합니다. ${ASK} 이 문서는 전화번호, 사업자등록번호, 담당자 이름을 적지 않습니다.` },
    { h: '시행일', p: EFFECTIVE },
  ] };
}

function terms() {
  return { title: '이용약관', sections: [
    { h: '서비스', p: 'WISH BOARD(모두의 전광판)는 뉴욕 타임스퀘어를 본뜬 3D 가상 광장의 전광판에 생일·기념일 축하, 응원, 소원을 거는 서비스입니다. 이용자는 캐릭터로 광장을 둘러보고, 친구나 가족에게 선물 전광판을 걸어 주고, 그 전광판에 친구들과 롤링페이퍼 메시지를 남길 수 있습니다. 팬덤, 동네, 친구 모임 같은 응원 팀은 함께 응원 목표를 채워 명당(메인 타워와 큰 화면)에 정해진 시간 동안 이름을 겁니다. 이 서비스는 게임이 아닙니다. 조작해서 응원 포인트나 경품 같은 보상을 얻는 놀이, 추첨, 확률로 무엇을 주는 기능은 없고, 광장에 남아 있는 리액션 동작, 폭죽, 택시 타고 이동하기 같은 놀이와 연출에는 보상이 없습니다. 자유 입력 채팅은 없고, 정해진 리액션만 보낼 수 있습니다. 이 광장은 뉴욕 타임스퀘어에서 영감을 받아 만든 가상 공간입니다. 실제 타임스퀘어와 그곳의 건물·단체·광고와는 관계가 없습니다.' },
    { h: '계정', p: '게스트로 바로 입장할 수 있습니다. 창을 닫으면 게스트의 응원 포인트와 전광판이 사라질 수 있습니다. 만 14세 이상이고 이용약관과 개인정보처리방침에 동의한 경우에만 계정을 만들 수 있습니다. 계정을 연결하면 게스트가 가진 전광판과 토지, 게스트가 모은 응원 포인트를 그 계정으로 옮깁니다. 게스트가 처음 받은 응원 포인트(시작 포인트와 도착 보너스)는 그 계정의 첫 연결 때만 옮기고, 계정 연결 보상은 계정마다 한 번만 줍니다. 아이디로 만든 계정은 비밀번호를 잊으면 되찾을 수 없습니다.' },
    { h: '응원 포인트', p: '응원 포인트는 이 서비스 안에서 응원과 꾸미기에만 쓰는 표시입니다. 출석(연속 출석 포함), 공유, 다른 사람의 전광판 구경과 응원, 내 전광판과 소원이 받은 하트, 친구 초대, 계정 연결로 얻고, 명당 응원, 일반 전광판 걸기, 꾸미기에 씁니다. 조작하는 놀이나 추첨으로는 주지 않습니다. 운영자는 응원 포인트를 돈을 받고 팔지 않습니다. 응원 포인트는 다른 사람에게 보내거나 넘길 수 없고, 현금·상품권·경품이나 다른 서비스의 포인트로 바꿀 수 없습니다. 현금 가치가 없으므로 탈퇴하거나 서비스가 끝날 때 돈으로 돌려주지 않습니다. 응원 포인트, 전광판, 계정은 돈이나 다른 재산을 받고 사고팔거나 빌려줄 수 없고, 그런 거래를 알선해서도 안 됩니다. 여러 계정이나 자동 프로그램을 쓰거나 오류를 이용하는 것처럼 부정한 방법으로 포인트를 얻거나 이런 거래를 한 것이 확인되면, 운영자는 그 계정에 알리고 그 포인트를 거두거나 그 계정의 이용을 제한할 수 있습니다. 오류로 잘못 들어가거나 빠진 포인트는 바로잡습니다. 포인트를 얻는 곳과 쓰는 곳, 하루 상한은 서비스 화면에 보이고, 바뀌면 화면에 알립니다.' },
    { h: '명당과 전광판', p: '명당(메인 타워와 큰 화면)은 돈으로 팔지 않습니다. 명당은 서비스 화면에 공개한 규칙에 따라 정해진 시간 동안 돌아갑니다. 예를 들어 서로 다른 여러 사람이 응원한 응원 목표를 채운 전광판, 오늘 응원에 참여한 팀원의 비율이 높은 팀, 기념일을 맞은 사람에게 돌아가고, 추첨으로 정하지 않습니다. 어떤 유료 결제도 응원 포인트, 응원 목표, 팀 순위, 참여율 계산에 들어가지 않습니다. 일반 전광판은 정한 기간 동안 걸리고 기간이 끝나면 내려갑니다. 다른 사람의 전광판을 포인트로 빼앗는 기능은 없습니다.' },
    { h: '선물 전광판과 롤링페이퍼', p: '선물 전광판은 받는 사람을 위해 생일·기념일·응원 문구를 정한 날 광장의 화면에 거는 전광판입니다. 만든 사람은 받는 사람을 부를 이름과 날짜, 문구를 정하고, 받는 사람의 전화번호나 주소 같은 연락처는 적지 않습니다. 만든 사람이 링크를 보내면 링크를 받은 사람은 누구나 기념 페이지를 열고 롤링페이퍼 메시지를 남길 수 있습니다. 무료 선물 전광판은 정한 날 광장의 화면에 걸리고, 어느 화면에 얼마 동안 걸리는지는 만들 때 화면에 보여 줍니다. 기념 페이지, 롤링페이퍼 메시지, 서버에 저장한 축하 영상은 그날이 지나고 7일 동안 볼 수 있습니다. 자기가 만든 전광판이나 쓴 메시지를 지우고 싶으면 설정의 문의하기로 요청할 수 있습니다.' },
    { h: '게시물', p: '선물 전광판 문구, 롤링페이퍼 메시지, 소원, 닉네임, 사진 같은 게시물의 권리와 책임은 쓴 사람에게 있습니다. 운영자는 게시물을 광장의 화면, 기념 페이지, 공유 링크의 미리보기 그림과 축하 영상에 보이는 데 필요한 만큼만 씁니다. 다음 게시물은 올릴 수 없습니다: 다른 사람을 비방하거나 모욕하는 글, 다른 사람의 개인정보(전화번호, 주소, 계정 등)를 드러내는 글, 음란하거나 폭력적이거나 혐오를 부추기는 글, 청소년에게 해로운 글, 법령에 어긋나는 글, 광고와 스팸, 다른 사람의 저작물이나 상표를 권리 없이 쓰는 것. 사진을 올릴 수 있는 곳에서는 본인 사진이나 찍힌 사람의 동의를 받은 사진만 올릴 수 있고, 사진은 운영자가 확인하고 승인한 것만 다른 사람에게 보입니다. 아이돌이나 연예인처럼 널리 알려진 사람의 이름은 누구를 응원하는지 나타내는 응원 라벨로 쓸 수 있습니다. 그 사람의 사진과 초상, 소속사의 로고와 공식 이미지는 권리자의 허락 없이 올릴 수 없고(팬이 찍은 사진과 팬아트도 같습니다), 운영자가 파는 유료 상품에는 넣지 않습니다. 유료 상품에는 글자와 WISH BOARD 디자인만 씁니다. 운영자는 이 규칙에 맞지 않는 게시물을 미리 거르거나, 알게 되면 가리거나 지울 수 있고, 되풀이되면 그 계정의 이용을 제한할 수 있습니다. 게시물이 이 규칙에 어긋나거나 내 권리를 침해하면 전광판의 신고 버튼이나 설정의 문의하기로 알려 주세요. 운영자는 확인한 뒤 지체 없이 가리거나 지우고, 권리자가 요청하면 그 게시물을 내립니다.' },
    { h: '유료 상품(준비 중)', p: '지금은 유료 상품을 팔지 않습니다. 운영자가 유료 상품을 열면 이 조항과 다음 조항을 따르고, 결제하기 전에 상품 내용, 부가가치세를 포함한 최종 가격, 청약철회와 환불 규정을 결제 화면에 보여 줍니다. 유료 상품은 선물 전광판을 더 크게·더 오래 거는 것, 축하 영상, 기념 페이지 보관처럼 한 번 결제하고 바로 받는 디지털 상품입니다. 자동으로 갱신되는 정기 결제는 없습니다. 운영자는 응원 포인트, 명당, 응원 목표 달성, 팀 순위를 팔지 않고, 확률로 내용이 정해지는 상품(뽑기)도 팔지 않습니다. 결제하기 전에 무료 선물 전광판과 워터마크가 들어간 미리보기 영상으로 상품을 체험할 수 있습니다. 보관 기간은 상품마다 정한 기간이며 영구 보관을 약속하지 않습니다. 만 14세 미만은 유료 상품을 살 수 없습니다.' },
    { h: '유료 상품의 취소와 환불', p: '간단히 말하면, 게시가 시작되기 전에는 언제든 모두 돌려드리고, 시작된 뒤에는 아직 제공하지 않은 몫과 운영자 때문에 제공하지 못한 몫을 돌려드립니다. 전광판 게시나 축하 영상 만들기가 시작되기 전에 취소하면, 결제한 날부터 7일이 지났더라도 낸 금액을 모두 돌려드립니다. 게시나 영상 제공이 시작된 디지털 콘텐츠는 청약철회가 제한될 수 있습니다(전자상거래법 제17조제2항제5호). 운영자는 결제 화면에 이 사실을 미리 알리고 무료 선물 전광판과 미리보기 영상을 체험 수단으로 줍니다(같은 조 제6항). 다만 여러 날에 걸친 상품은 시작된 뒤에도 아직 제공되지 않은 날을 그 전날까지 취소할 수 있고, 그 날수만큼 나누어 돌려드립니다. 운영자 쪽 장애나 점검으로 상품이 그날 합해서 1시간 넘게 제공되지 못했거나 운영자가 게시물을 내린 경우에는 그 몫을 돌려드리거나, 원하면 다른 날에 제공합니다. 상품이 설명과 다르게 제공되면 제공받은 날부터 3개월 안에, 또는 그 사실을 안 날부터 30일 안에 취소하고 돌려받을 수 있습니다. 취소와 환불은 설정의 문의하기로 하면 됩니다. 운영자는 요청을 받은 날부터 3영업일 안에 결제한 수단으로 돌려드리고, 늦어지면 늦어진 기간에 대해 연 15%의 지연이자를 더해 드립니다. 만 19세 미만인 사람이 법정대리인의 동의 없이 결제한 경우에는 본인이나 법정대리인이 계약을 취소할 수 있습니다(민법 제5조). 운영자가 서비스를 끝낼 때는 30일 전에 알리고, 아직 제공하지 않은 유료 상품의 값을 돌려드리며, 기념 페이지의 영상과 사진을 내려받을 수 있는 기간을 둡니다.' },
    { h: '탈퇴', p: '로그인한 회원은 설정에서 회원 탈퇴를 할 수 있습니다. 탈퇴하면 그 회원의 지갑과 응원 포인트, 전광판·토지 소유, 사진, 소원, 알림 구독을 지우고, 로그인 정보(계정, 연결된 소셜 로그인, 로그인 세션)도 지웁니다. 탈퇴 화면에서 로그인 정보가 자동으로 지워지지 않는다고 안내한 경우에는 운영자가 확인한 뒤 지웁니다. 되돌릴 수 없습니다. 다른 사람의 데이터는 지우지 않습니다. 탈퇴한 뒤 같은 이메일로 다시 가입해도 계정 연결 보상은 다시 주지 않습니다.' },
    { h: '운영자', p: (OP ? `${operatorLine(OP)}. ${ASK}` : `문의는 ${CONTACT}에게 합니다. ${ASK}`) + ` ${HOST}` },
    { h: '시행일', p: EFFECTIVE },
  ] };
}

// 광고 서비스 (상6: the ad-only screens, adsale.js / adsrv.js). Kept apart from the sections above and shown always: it says what
// the operator may sell, so it is true whether ADS_ON is on or off. Reviewed against 전자상거래법·표시광고법·약관법 on 2026-11-22 by an AI,
// not a lawyer (docs/legal-answers-2026-11-22.md). /ads (adspage.js) shows the same 취소·환불 rules before a request is sent.
const AD_TERMS = [
  { h: '광고 서비스', p: '운영자는 광장 안의 광고 전용 화면(명당, 일반 전광판, 선물 전광판과 따로 있는 화면)에 하루 단위 광고, 생일·응원 광고, 밤 9시 60초 스폰서를 판매할 수 있습니다. 하루 단위 광고와 생일·응원 광고는 정한 날마다 한국 시간 0시부터 24시까지 광고 화면 한 곳에 나갑니다. 밤 9시 60초 스폰서는 잡힌 날마다 한국 시간 21시 정각부터 60초 동안 광고 화면 다섯 곳 모두를 차지하고, 그 60초 동안은 그 화면들의 하루 광고와 생일·응원 광고가 나가지 않으며 그 광고의 링크 클릭과 화면 봄도 세지 않습니다. 광고는 광고 안내 페이지(/ads)의 신청서를 받은 뒤 운영자가 문구와 링크를 검토하고 견적을 이메일로 보내며, 광고주가 견적에 적힌 계좌로 입금하고 운영자가 그 입금을 확인하면 계약이 이루어집니다. 신청서를 보내는 것만으로는 계약이 이루어지지 않고 돈이 나가지 않습니다. 견적에는 상품, 날짜, 광고 화면, 금액과 부가가치세 포함 여부, 입금 기한, 발급할 수 있는 증빙(세금계산서, 현금영수증 등), 이 약관의 취소와 환불 규정을 적습니다. 카드 결제는 받지 않습니다. 광고 화면에는 ‘광고’ 표시가 붙습니다. 광고를 사도 광장의 전광판·명당·응원 포인트를 얻지 않고, 응원 목표나 팀 순위에도 들어가지 않습니다. 운영자는 접속자 수와 노출 횟수를 보장하지 않고, 광고 안내 페이지와 리포트의 숫자는 광장이 센 수입니다. 운영자는 계약한 광고를 광고 화면에 보이고 리포트에 싣는 데 필요한 만큼만 광고 문구와 링크를 씁니다.' },
  { h: '광고 기준', p: '운영자는 다음 광고를 받지 않습니다: 법령에 어긋나는 광고, 거짓이거나 부풀리거나 소비자를 속일 수 있는 광고, 다른 사람이나 회사를 근거 없이 깎아내리는 광고, 청소년에게 해로운 광고(술·담배, 성인용 상품과 서비스, 도박과 사행행위, 청소년유해매체물 등), 불법 대부와 투자 권유, 의약품·의료·건강기능식품처럼 미리 심의를 받아야 하는 광고 가운데 심의를 받지 않은 것, 선거운동, 다른 사람의 상표·저작물·이름·사진을 권리 없이 쓰는 광고, 링크한 곳에 이런 내용이 있거나 악성 프로그램을 퍼뜨리는 광고. 이 광장은 계정 없이 누구나 손님으로 들어올 수 있으므로, 광고는 청소년이 보아도 되는 내용이어야 합니다. 운영자는 이 기준에 맞지 않는 신청을 거절하거나 고쳐 달라고 요청할 수 있고, 송출 중에 알게 되면 그 이유를 광고주에게 알리고 광고를 내릴 수 있습니다. 생일·응원 광고에 다른 사람의 이름이나 사진을 쓰려면 광고주가 그 사람이나 소속사의 정책을 확인해야 하고, 권리자가 내려 달라고 하면 운영자는 광고를 내릴 수 있습니다. 광고 문구와 링크에 대한 권리와 책임은 광고주에게 있습니다. 다만 운영자의 고의나 과실로 생긴 손해는 운영자가 책임집니다.' },
  { h: '광고 취소와 환불', p: '송출이 시작되기 전에 취소하면 낸 금액을 모두 돌려드립니다. 여러 날을 산 광고는 송출이 시작된 뒤에도 아직 송출되지 않은 날을 그 전날까지 취소할 수 있고, 취소한 날수(밤 9시 스폰서는 횟수)만큼 나누어 돌려드립니다. 운영자 쪽 장애나 점검으로 광고가 그날 합해서 1시간 넘게 나가지 못한 날이 있거나 운영자가 광고를 내린 경우에는, 나가지 못한 날수만큼 나누어 돌려드리거나 광고주가 원하면 광고주와 정한 다른 날에 송출합니다. 광고가 견적이나 이 약관과 다르게 송출되면 송출된 날부터 3개월 안에, 또는 그 사실을 안 날부터 30일 안에 계약을 취소하고 돌려받을 수 있습니다. 취소는 견적 이메일에 답장하거나 설정의 문의하기로 하면 됩니다. 운영자는 취소를 받은 날부터 3영업일 안에 입금한 계좌로 돌려드리고, 늦어지면 늦어진 기간에 대해 연 15%의 지연이자를 더해 드립니다. 만 19세 미만인 사람이 법정대리인의 동의 없이 광고를 산 경우에는 본인이나 법정대리인이 계약을 취소할 수 있습니다. 광고주와 따로 정한 내용이 이 조항과 다르면 광고주에게 유리한 쪽을 따릅니다.' },
];
const AD_PRIVACY = { h: '광고 문의', p: '광고 안내 페이지(/ads)의 신청서로 회사 또는 이름, 이메일, 광고 문구를 받고, 적은 경우에만 전화번호, 링크, 요청 사항을 받습니다. 전화번호, 링크, 요청 사항은 적지 않아도 신청할 수 있습니다. 광고 문의 처리, 견적과 입금 안내, 송출 일정 연락, 광고 리포트 전달에만 쓰고, 광고나 홍보 메일을 보내는 데 쓰지 않습니다. 신청서는 문의일로부터 1년 뒤 지웁니다. 계약이 이루어지면 법령이 보관하라고 정한 기록은 신청서와 따로 그 기간 동안 보관합니다: 계약과 취소, 대금 결제와 광고 송출에 관한 기록은 5년, 불만과 분쟁 처리에 관한 기록은 3년(전자상거래법), 세금계산서 같은 세금 관련 장부와 증빙은 5년(국세기본법)입니다. 만 14세 미만은 광고를 신청할 수 없습니다. 신청서를 보낸 곳의 IP 주소는 되돌릴 수 없는 값으로 바꿔 그날의 신청 횟수를 세는 데만 쓰고, 다음 날 지웁니다. 광장에서 광고 화면의 링크를 누르거나 화면이 시야에 들어온 것을 셀 때는 계정을 되돌릴 수 없는 값으로 바꿔 그날만 보관하고, 광고주에게 주는 리포트에는 날짜별 합계(연결된 계정과 게스트를 나눈 수)만 들어갑니다.' };
// The ad sections of the terms go right before 시행일, their last section. The privacy policy places 광고 문의 itself, ahead of
// 처리 위탁과 국외 이전, which covers the ad requests too.
const withAd = (doc, extra) => ({ ...doc, sections: [...doc.sections.slice(0, -1), ...[].concat(extra), ...doc.sections.slice(-1)] });

// { title, sections: [{ h, p }] } for 'privacy' or 'terms', null for anything else. Plain text only.
export function policyDoc(kind) {
  return kind === 'privacy' ? privacy() : kind === 'terms' ? withAd(terms(), AD_TERMS) : null;
}

export function mountPolicyDoc() {
  const kind = policyKind();
  if (!kind || document.getElementById('policy')) return !!kind;
  const boot = document.getElementById('boot');
  if (boot) boot.hidden = true;
  const view = document.getElementById('view');
  if (view) view.hidden = true;
  const root = document.createElement('main');
  root.id = 'policy';
  root.className = 'policydoc';
  root.append(article(policyDoc(kind)));
  document.body.append(root);
  // The full page has no plaza to tell it the operator's details: one read of /rt/config, and the text again when they are there.
  try { fetch('/rt/config', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.operator && setOperator(j.operator)) root.replaceChildren(article(policyDoc(kind))); }).catch(() => { }); } catch { /* the text without them stays */ }
  document.title = kind === 'privacy' ? '개인정보처리방침 · WISH BOARD' : '이용약관 · WISH BOARD';
  return true;
}

if (typeof document !== 'undefined') mountPolicyDoc();
