// Operations rules shared by the Worker (ops.js) and the page (errlog.js, ui.js): what an error report may carry, what an inquiry must be,
// how the operator's details and the maintenance notice are cleaned. Pure functions, no imports: the Worker bundles this file, so every
// import of it is written without a query (tools/stamp.mjs).

export const ERR = { msg: 300, src: 120, frames: 5, stack: 800, page: 60, perLoad: 5, leanRate: 0.2 };
export const SUP = { min: 10, max: 1000, email: 120, nick: 16 };
// 분류: the id travels, the label is shown. 'ads' links to the ad page.
export const SUPPORT_KINDS = [['bug', '버그'], ['account', '계정·포인트'], ['report', '신고'], ['ads', '광고·제휴'], ['etc', '기타']];
export const SUPPORT_TEXT = {
  kind: '분류를 골라 주세요.',
  short: '내용을 10자 이상 적어 주세요.',
  long: '내용은 1000자까지 적을 수 있어요.',
  email: '이메일 주소를 다시 확인해 주세요.',
  agree: '답장 받을 이메일을 적었다면 안내에 동의해 주세요.',
  rate: '문의는 한 시간에 세 번까지 보낼 수 있어요. 잠시 뒤에 다시 보내 주세요.',
  many: '지금은 문의가 몰려 있어요. 한 시간쯤 뒤에 다시 보내 주세요.',
  full: '답을 기다리는 문의가 많아 지금은 받을 수 없어요. 잠시 뒤에 다시 보내 주세요.',
  busy: '지금은 광장이 붐벼요. 문의는 잠시 뒤에 다시 보내 주세요.',
  down: '문의를 보내지 못했어요. 잠시 뒤에 다시 해 주세요.',
};
export const SUPPORT_CONSENT = '답장 받을 이메일은 이 문의의 답장에만 쓰고, 처리한 뒤 1년 안에 지웁니다.';
export const MAINT_DEFAULT = '더 나은 광장을 위해 잠시 점검하고 있어요.';

const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
const chars = (s, n) => Array.from(String(s ?? '')).slice(0, n).join('');
// One line: control characters out, runs of spaces folded, cut to n characters.
export function line(s, n) { return chars(String(s ?? '').replace(/\r?\n|\r|\t/g, ' ').replace(CTRL, '').replace(/ {2,}/g, ' ').trim(), n); }
// Several lines (an inquiry): control characters out except newlines, at most two newlines in a row.
export function body(s) { return String(s ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CTRL, '').replace(/\n{3,}/g, '\n\n').trim(); }
export const textLen = (s) => Array.from(String(s ?? '')).length;

export function emailOk(s) { const t = String(s ?? '').trim(); return t.length <= SUP.email && /^[^\s@<>"'(),;:]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/i.test(t); }
export const supportKind = (k) => (SUPPORT_KINDS.some(([id]) => id === k) ? k : '');

// '' when the inquiry can go, else the SUPPORT_TEXT code. email is optional; when given it must look like one and agree must be true.
export function supportFault({ kind, text, email, agree } = {}) {
  if (!supportKind(kind)) return 'kind';
  const n = textLen(body(text));
  if (n < SUP.min) return 'short';
  if (n > SUP.max) return 'long';
  const e = String(email ?? '').trim();
  if (e && !emailOk(e)) return 'email';
  if (e && agree !== true) return 'agree';
  return '';
}

// ---- error reports
// Anything that could point at a person or a session comes out: scheme://host, ?query and #hash, e-mail addresses, tokens, long digit runs.
export function scrub(s) {
  return String(s ?? '')
    .replace(/\b(?:eyJ[\w-]{6,}\.[\w-]{6,}(?:\.[\w-]+)?|g1\.[\w-]{8,}(?:\.[\w-]+)*|sb_[a-z]+_[\w-]{8,})/g, '<token>')
    .replace(/[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi, '<email>')
    .replace(/\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/)'"]*/gi, '')
    .replace(/\b(?:blob|data):[^\s)'"]*/gi, '')
    .replace(/\?[^\s)'":#]*/g, '')
    .replace(/#[^\s)'":]*/g, '')
    .replace(/\d{7,}/g, '<n>');
}
// 'ui.js:12:34' from any form a browser gives (a full address with a query, a path), '' when there is none.
export function srcOf(file, ln, col) {
  let f = scrub(String(file ?? '').trim()).replace(/^\/+/, '');
  if (!f) return '';
  const at = [Number(ln) > 0 ? Math.floor(Number(ln)) : 0, Number(col) > 0 ? Math.floor(Number(col)) : 0];
  if (at[0] && !/:\d+(?::\d+)?$/.test(f)) f += ':' + at[0] + (at[1] ? ':' + at[1] : '');
  return chars(f, ERR.src);
}
export function stackOf(s) {
  const frames = scrub(String(s ?? '')).split('\n').map((x) => line(x, 200)).filter((x) => x && /[:@]|\bat\b/.test(x)).slice(0, ERR.frames);
  return chars(frames.join('\n'), ERR.stack);
}
// The page's path with every id-like segment folded, so two players' share links group together: /rt/w/abc123defg -> /rt/w/:id.
export function pathOf(p) { return chars(String(p ?? '/').split(/[?#]/)[0].replace(/[^\w/.-]/g, '').split('/').map((seg) => (/^[\w-]{8,}$/.test(seg) && /\d/.test(seg) ? ':id' : seg)).join('/') || '/', ERR.page); }
export const BUILD_RE = /^\d{8,14}[a-z]?$/;
const TIERS = new Set(['high', 'medium', 'low', 'auto']);
const UA_RE = /^[a-z]{2,12}(?:\/[a-z]{2,10})?$/;
// A client report as the Worker keeps it, or null when it carries no message. Only these fields: nothing else of the body is kept.
export function errRow(b, kind = 'client') {
  if (!b || typeof b !== 'object') return null;
  const msg = line(scrub(b.m), ERR.msg);
  if (!msg) return null;
  return {
    kind,
    msg,
    src: srcOf(b.s),
    stack: stackOf(b.k),
    build: BUILD_RE.test(String(b.b || '')) ? String(b.b) : '',
    page: pathOf(b.p),
    tier: TIERS.has(String(b.q)) ? String(b.q) : '',
    touch: b.t === 1 || b.t === true ? 1 : 0,
    ua: UA_RE.test(String(b.ua || '')) ? String(b.ua) : '',
  };
}
// 'chrome/android', 'safari/ios', 'kakao/ios', … from a user agent string: a family and a platform, never a version.
export function uaFamily(ua) {
  const s = String(ua || '');
  const os = /iPhone|iPad|iPod/.test(s) ? 'ios' : /Android/.test(s) ? 'android' : /Windows/.test(s) ? 'windows' : /Macintosh|Mac OS X/.test(s) ? 'mac' : /CrOS/.test(s) ? 'chromeos' : /Linux/.test(s) ? 'linux' : 'other';
  const fam = /KAKAOTALK/i.test(s) ? 'kakao' : /NAVER/.test(s) ? 'naver' : /Instagram|FBAN|FBAV|Line\//.test(s) ? 'inapp' : /SamsungBrowser/.test(s) ? 'samsung'
    : /Edg\//.test(s) ? 'edge' : /Firefox|FxiOS/.test(s) ? 'firefox' : /Chrome|CriOS/.test(s) ? 'chrome' : /Safari/.test(s) ? 'safari' : 'other';
  return fam + '/' + os;
}

// ---- operator details (Worker var OPERATOR_INFO, JSON). Only the known fields, each one line and capped; null when nothing is left.
export const OPERATOR_FIELDS = [['name', '상호', 60], ['ceo', '대표', 30], ['biz', '사업자등록번호', 24], ['mail', '통신판매업 신고번호', 40], ['addr', '주소', 120], ['email', '이메일', 80], ['phone', '전화', 24]];
export function operatorOf(raw) {
  let o = raw;
  if (typeof raw === 'string') { if (!raw.trim()) return null; try { o = JSON.parse(raw); } catch { return null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const [k, , n] of OPERATOR_FIELDS) { if (typeof o[k] !== 'string' && typeof o[k] !== 'number') continue; const v = line(o[k], n); if (v) out[k] = v; }
  if (out.email && !emailOk(out.email)) delete out.email;
  return Object.keys(out).length ? out : null;
}
// '상호 ○○ · 대표 ○○ · …' in the field order, '' for none.
export function operatorLine(op, keys = OPERATOR_FIELDS.map(([k]) => k)) {
  if (!op || typeof op !== 'object') return '';
  return OPERATOR_FIELDS.filter(([k]) => keys.includes(k) && op[k]).map(([k, label]) => `${label} ${op[k]}`).join(' · ');
}

// ---- maintenance: { msg, until } (until: ms since epoch, 0 = no end time given), or null when off.
export function maintOf(m) {
  if (!m || typeof m !== 'object' || m.on === false) return null;
  const until = Number(m.until);
  return { msg: line(m.msg, 120) || MAINT_DEFAULT, until: Number.isFinite(until) && until > 0 ? Math.floor(until) : 0 };
}
// '11월 22일 오후 3:05' in Korea time.
export function kstWhen(ms) {
  const d = new Date(Number(ms) + 9 * 3600e3);
  if (!Number.isFinite(d.getTime())) return '';
  const hh = d.getUTCHours(), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}:${mm}`;
}
// The lines the boot card shows for a notice.
export function maintLines(m, now = Date.now()) {
  const v = maintOf(m);
  if (!v) return null;
  const end = !v.until ? '끝나는 대로 바로 열어요.' : v.until > now ? `${kstWhen(v.until)}(한국 시간)에 끝날 예정이에요.` : '예정보다 조금 늦어지고 있어요. 곧 다시 열어요.';
  return { title: '지금은 점검 중이에요', msg: v.msg, end };
}
