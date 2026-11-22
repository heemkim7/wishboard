// Policy documents. policyDoc(kind) is the text: the plaza unfolds it inside its own sheets (ui.js), so reading it never leaves the game.
// A direct ?policy= load still paints the full-page document. This module has no game imports so it can paint before the plaza loads.
const CONTACT = 'Wishboard 운영자';
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
    { h: '이용자의 권리', p: '자신의 계정 정보를 열람할 수 있고, 설정에 있는 회원 탈퇴로 삭제를 요청할 수 있습니다.' },
    { h: '개인정보 문의', p: `개인정보 문의는 ${CONTACT}에게 합니다. 이 문서는 전화번호, 사업자등록번호, 담당자 이름을 적지 않습니다.` },
    { h: '시행일', p: EFFECTIVE },
  ] };
}

function terms() {
  return { title: '이용약관', sections: [
    { h: '서비스', p: '위시보드는 타임스퀘어를 배경으로 코인을 모아 전광판과 토지를 차지하는 게임입니다. 자유 입력 채팅은 없고, 정해진 리액션만 보낼 수 있습니다.' },
    { h: '계정', p: '게스트로 바로 입장할 수 있습니다. 창을 닫으면 게스트의 코인과 전광판이 사라질 수 있습니다. 만 14세 이상이고 이용약관과 개인정보처리방침에 동의한 경우에만 계정을 만들 수 있습니다. 계정을 연결하면 전광판과 토지 소유, 게스트가 모은 코인을 그 계정으로 옮깁니다. 게스트가 처음 받은 코인(시작 100과 도착 보너스)은 그 계정의 첫 연결 때만 옮기고, 연결 보상 300코인은 계정마다 한 번만 줍니다. 아이디로 만든 계정은 비밀번호를 잊으면 되찾을 수 없습니다.' },
    { h: '코인', p: '코인은 게임 안의 점수입니다. 현금으로 바꾸지 않습니다. 전광판 점령과 토지 분양은 코인으로만 합니다. 다른 사람에게 코인을 보내거나 소속에 모금하는 것은 계정만 할 수 있고, 처음 받은 400코인(시작 100 + 연결 보상 300)보다 더 모은 만큼만 보낼 수 있습니다.' },
    { h: '탈퇴', p: '로그인한 회원은 설정에서 회원 탈퇴를 할 수 있습니다. 탈퇴하면 그 회원의 지갑과 코인, 전광판·토지 소유, 사진, 소원, 알림 구독을 지우고, 로그인 정보(계정, 연결된 소셜 로그인, 로그인 세션)도 지웁니다. 탈퇴 화면에서 로그인 정보가 자동으로 지워지지 않는다고 안내한 경우에는 운영자가 확인한 뒤 지웁니다. 되돌릴 수 없습니다. 다른 사람의 데이터는 지우지 않습니다. 탈퇴한 뒤 같은 이메일로 다시 가입해도 시작 코인과 연결 보상은 다시 주지 않습니다.' },
    { h: '운영자', p: `문의는 ${CONTACT}에게 합니다.` },
    { h: '시행일', p: EFFECTIVE },
  ] };
}

// { title, sections: [{ h, p }] } for 'privacy' or 'terms', null for anything else. Plain text only.
export function policyDoc(kind) {
  return kind === 'privacy' ? privacy() : kind === 'terms' ? terms() : null;
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
  document.title = kind === 'privacy' ? '개인정보처리방침 · WISH BOARD' : '이용약관 · WISH BOARD';
  return true;
}

if (typeof document !== 'undefined') mountPolicyDoc();
