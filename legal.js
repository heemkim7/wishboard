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
const who = () => OP?.name || CONTACT;
const EFFECTIVE = '2026년 11월 22일부터 적용합니다(개정 2026-11-22).';

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

function privacy() {
  return { title: '개인정보처리방침', sections: [
    { h: '수집하는 항목', p: '계정 연결 시 이메일 또는 소셜 로그인 식별자, 닉네임, 서비스 이용 기록과 접속 기록을 수집합니다. 구글로 로그인하면 구글이 알려 주는 이메일, 프로필 이름, 프로필 사진 주소가 로그인 정보(Supabase Auth)에 함께 저장됩니다. 이 이름과 사진은 게임 화면에 쓰지 않고, 게임에는 직접 정한 닉네임만 보입니다. 아이디로 가입하면 아이디와 비밀번호(되돌릴 수 없게 바꾼 값)만 저장합니다. 전화번호는 수집하지 않습니다.' },
    { h: '이용 목적', p: '계정 식별, 코인과 전광판의 유지, 유료 서비스 제공, 부정 이용 방지를 위해 사용합니다.' },
    { h: '보유 기간', p: `회원 탈퇴 시 삭제합니다. 탈퇴하면 그 계정의 지갑 연결과 그 계정이 가진 전광판·토지 소유를 지웁니다. 로그인 정보(이메일 또는 소셜 로그인 식별자)는 탈퇴와 함께 지웁니다. 탈퇴 화면에서 자동으로 지워지지 않는다고 안내한 경우에는 운영자가 확인한 뒤 지우며, ${CONTACT}에게 요청하면 지웁니다. 탈퇴한 뒤에는 연결 보상이 다시 지급되는 것을 막으려고, 계정으로 되돌릴 수 없는 값(계정 식별자와 이메일을 각각 해시한 값)만 보관합니다.` },
    { h: '방문 통계 (Google 애널리틱스)', p: '방문자 수와 이용 흐름을 보려고 Google 애널리틱스를 씁니다. 따로 묻지 않고 처음부터 켜져 있습니다. 설정의 ‘방문 통계 보내지 않기’를 켜면 그 브라우저에서는 Google 애널리틱스를 불러오지 않고, 브라우저가 개인정보 보호 신호(Global Privacy Control)를 보내도 불러오지 않습니다. 켜져 있을 때 사이트를 열면 브라우저가 페이지 주소와 제목, 들어온 경로, 기기와 브라우저 종류, 화면 크기, 언어, 게임에서 쓴 기능의 이름을 Google 서버(국외)로 보내고, Google은 IP 주소로 대략의 지역을 추정합니다. 방문을 구분하려고 이름이 _ga로 시작하는 쿠키를 브라우저에 저장합니다. 이메일, 닉네임, 소원 글, 사진은 Google로 보내지 않습니다. 이 통계는 계정과 연결하지 않아서 회원 탈퇴로 지워지지 않습니다. Google 애널리틱스의 보관 기간은 이벤트 기록 2개월, 방문자 식별값 14개월로 설정되어 있고, 합산한 통계는 그 뒤에도 남습니다. 브라우저에서 쿠키를 지우거나 막을 수 있고, Google의 차단 부가 기능(https://tools.google.com/dlpage/gaoptout)을 설치하면 수집되지 않습니다.' },
    { h: '문의하기', p: '설정의 문의하기로 보낸 분류와 내용, 계정 번호, 닉네임, 기기 종류(휴대폰·태블릿·컴퓨터), 게임 버전, 보낸 화면의 경로를 저장합니다. 답장 받을 이메일은 적은 경우에만 저장하고 그 문의의 답장에만 씁니다. 문의에 답하고 문제를 고치려고 씁니다. 처리한 문의는 처리한 뒤 1년 안에 지우고, 보관은 최근 500건까지입니다. 같은 곳에서 너무 많이 보내는 것을 막으려고 접속 주소(IP)를 되돌릴 수 없게 바꾼 값을 1시간 동안 둡니다.' },
    { h: '오류 기록', p: '게임 화면에 오류가 나면 오류 문구, 오류가 난 파일과 줄, 게임 버전, 페이지 경로, 그래픽 품질, 터치 화면인지, 브라우저와 운영체제 종류를 운영 서버로 보냅니다. 계정 번호, 닉네임, 이메일, 주소의 검색어는 보내지 않습니다. 같은 오류끼리 묶어 최근 300종류만 남기고, 운영자가 고친 뒤 지웁니다.' },
    { h: '이용자의 권리', p: '자신의 계정 정보를 열람할 수 있고, 설정에 있는 회원 탈퇴로 삭제를 요청할 수 있습니다.' },
    { h: '개인정보 문의', p: OP ? `개인정보 문의는 ${who()}에게 합니다. ${operatorLine(OP)}. ${ASK}` : `개인정보 문의는 ${CONTACT}에게 합니다. ${ASK} 이 문서는 전화번호, 사업자등록번호, 담당자 이름을 적지 않습니다.` },
    { h: '시행일', p: EFFECTIVE },
  ] };
}

function terms() {
  return { title: '이용약관', sections: [
    { h: '서비스', p: '위시보드는 타임스퀘어를 배경으로 코인을 모아 전광판과 토지를 차지하는 게임입니다. 자유 입력 채팅은 없고, 정해진 리액션만 보낼 수 있습니다.' },
    { h: '계정', p: '게스트로 바로 입장할 수 있습니다. 창을 닫으면 게스트의 코인과 전광판이 사라질 수 있습니다. 만 14세 이상이고 이용약관과 개인정보처리방침에 동의한 경우에만 계정을 만들 수 있습니다. 계정을 연결하면 전광판과 토지 소유, 게스트가 모은 코인을 그 계정으로 옮깁니다. 게스트가 처음 받은 코인(시작 100과 도착 보너스)은 그 계정의 첫 연결 때만 옮기고, 연결 보상 300코인은 계정마다 한 번만 줍니다. 아이디로 만든 계정은 비밀번호를 잊으면 되찾을 수 없습니다.' },
    { h: '코인', p: '코인은 게임 안의 점수입니다. 현금으로 바꾸지 않습니다. 전광판 점령과 토지 분양은 코인으로만 합니다. 다른 사람에게 코인을 보내거나 소속에 모금하는 것은 계정만 할 수 있고, 선물로 받은 코인 580개까지는 보내거나 모금할 수 없습니다. 그보다 더 모은 만큼만 보낼 수 있습니다.' },
    { h: '탈퇴', p: '로그인한 회원은 설정에서 회원 탈퇴를 할 수 있습니다. 탈퇴하면 그 회원의 지갑과 코인, 전광판·토지 소유, 사진, 소원, 알림 구독을 지우고, 로그인 정보(계정, 연결된 소셜 로그인, 로그인 세션)도 지웁니다. 탈퇴 화면에서 로그인 정보가 자동으로 지워지지 않는다고 안내한 경우에는 운영자가 확인한 뒤 지웁니다. 되돌릴 수 없습니다. 다른 사람의 데이터는 지우지 않습니다. 탈퇴한 뒤 같은 이메일로 다시 가입해도 연결 보상 300코인은 다시 주지 않습니다.' },
    { h: '운영자', p: OP ? `${operatorLine(OP)}. ${ASK}` : `문의는 ${CONTACT}에게 합니다. ${ASK}` },
    { h: '시행일', p: EFFECTIVE },
  ] };
}

// 광고 서비스 (상6: the ad-only screens, adsale.js / adsrv.js). Kept apart from the sections above and shown always: it says what
// the operator may sell, so it is true whether ADS_ON is on or off. Needs a legal review before ads are sold (refunds, 표시광고법).
const AD_TERMS = { h: '광고 서비스', p: '운영자는 광장 안의 광고 전용 화면(코인으로 차지하는 전광판과 따로 있는 화면)에 하루 단위 광고, 생일·응원 광고, 밤 9시 60초 스폰서를 판매할 수 있습니다. 광고는 광고 안내 페이지(/ads)의 신청서를 받은 뒤 운영자가 문구와 링크를 검토하고, 견적과 입금(계좌이체 또는 세금계산서)을 확인한 다음 정한 날짜(한국 시간)에 송출합니다. 광고 화면에는 ‘광고’ 표시가 붙습니다. 운영자는 법령이나 이 약관에 어긋나거나 이용자에게 해가 될 수 있는 광고를 거절하거나 송출 중에도 내릴 수 있습니다. 광고를 사도 게임 안의 전광판·토지·코인을 얻지 않습니다. 운영자는 접속자 수와 노출 횟수를 보장하지 않고, 리포트의 숫자는 게임이 센 수입니다. 송출이 시작되기 전에 취소하면 낸 금액을 모두 돌려드립니다. 송출이 시작된 뒤 운영자 쪽 장애로 광고를 내보내지 못한 날이 있으면, 그 날수만큼 나누어 돌려드리거나 광고주와 정한 다른 날에 송출합니다. 그 밖의 취소와 환불은 광고주와 따로 정한 내용에 따릅니다. 광고 문구와 링크에 대한 권리와 책임은 광고주에게 있습니다.' };
const AD_PRIVACY = { h: '광고 문의', p: '광고 안내 페이지(/ads)의 신청서로 회사 또는 이름, 이메일, 전화번호(적은 경우), 광고 문구와 링크, 요청 사항을 받습니다. 광고 문의 처리, 견적과 입금 안내, 송출 일정 연락에만 쓰고, 문의일로부터 1년 뒤 지웁니다. 계약이 이루어지면 세금계산서처럼 법령이 보관 기간을 정한 기록은 그 기간 동안 보관합니다. 신청서를 보낸 곳의 IP 주소는 되돌릴 수 없는 값으로 바꿔 그날의 신청 횟수를 세는 데만 쓰고, 다음 날 지웁니다. 광장에서 광고 화면의 링크를 누르거나 화면이 시야에 들어온 것을 셀 때는 계정을 되돌릴 수 없는 값으로 바꿔 그날만 보관하고, 광고주에게 주는 리포트에는 날짜별 합계만 들어갑니다.' };
// The ad section goes right before 시행일, the last section of both documents.
const withAd = (doc, extra) => ({ ...doc, sections: [...doc.sections.slice(0, -1), extra, ...doc.sections.slice(-1)] });

// { title, sections: [{ h, p }] } for 'privacy' or 'terms', null for anything else. Plain text only.
export function policyDoc(kind) {
  return kind === 'privacy' ? withAd(privacy(), AD_PRIVACY) : kind === 'terms' ? withAd(terms(), AD_TERMS) : null;
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
