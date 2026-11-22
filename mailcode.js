// E-mail confirmation by a 6-digit code (Supabase "Confirm email"). Rules only, for net.js, main.js and the login sheet in ui.js: no DOM, no network.
// "Confirm email" off: a sign-up gets a session at once and none of this shows (today). On: signUp answers with a user and no session and mails
// the template's {{ .Token }}. The player types it into the same tab, so the guest that holds the coins is the one that gets linked; a link
// opened from a mail app often lands in another browser with another guest.
import { authErrorText } from './plaza-account.js';

export const CODE_WAIT_S = 60; // between two code mails; Supabase's own minimum per address is 60 s by default
export const ID_HOST = '@id.wishboard.dev'; // an id sign-up (plaza-account.js loginEmail): no mailbox behind it

// A real mailbox, not an id's stand-in address.
export function isMailbox(email) {
  const s = String(email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && !s.endsWith(ID_HOST);
}

// GET <supabase>/auth/v1/settings (public): 'on' when a new address must be confirmed first (mailer_autoconfirm false), 'off' when a sign-up
// signs in at once, '' when it cannot be told.
export function confirmState(settings) {
  const v = settings && typeof settings === 'object' ? settings.mailer_autoconfirm : undefined;
  return v === false ? 'on' : v === true ? 'off' : '';
}

// emailRedirectTo of the sign-up and the code mails. Only an older template has a link at all; ?mail=1 tells the page it came from one.
export function mailReturn(origin) { return String(origin || '') + '/?mail=1'; }
export function mailBack(search) { return new URLSearchParams(String(search || '').replace(/^\?/, '')).get('mail') === '1'; }

// The digits of what was typed or pasted ("123 456", "123-456", full-width digits). '' unless 6 to 10 of them (Supabase's code length is 6 to 10).
export function otpDigits(raw) {
  const s = String(raw ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '');
  return /^\d{6,10}$/.test(s) ? s : '';
}
// What the code field keeps while typing: digits only, at most 10.
export function otpField(raw) {
  return String(raw ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '').slice(0, 10);
}

// "For security purposes, you can only request this after 42 seconds." -> 42. 0 for any other error.
export function retryAfterS(e) {
  const m = /after (\d{1,4}) seconds?/i.exec(String(e?.message || ''));
  return m ? Math.min(3600, Math.max(1, Number(m[1]))) : 0;
}

// signInWithPassword's "Email not confirmed". Supabase checks the password before this, so only the code is missing.
export function unconfirmed(e) {
  return String(e?.code || '') === 'email_not_confirmed' || /email not confirmed/i.test(String(e?.message || ''));
}

// What signUp answered ({ data, error }):
//   session  a session (confirmation off)
//   code     a code is on its way, or one went out under a minute ago (wait: seconds until another can be asked for)
//   exists   confirmation on answers an address that is already confirmed with a stand-in user without identities, not with an error
//   error    anything else (error may be null: no user and no session)
export function signUpOutcome(r) {
  const error = r?.error || null, data = r?.data || {};
  if (error) {
    const wait = String(error.code || '') === 'over_email_send_rate_limit' || /for security purposes/i.test(String(error.message || '')) ? retryAfterS(error) : 0;
    return wait ? { kind: 'code', wait } : { kind: 'error', error };
  }
  if (data.session) return { kind: 'session', session: data.session };
  const user = data.user;
  if (user && Array.isArray(user.identities) && user.identities.length === 0) return { kind: 'exists' };
  if (user) return { kind: 'code', wait: 0 };
  return { kind: 'error', error: null };
}

export const MAIL_ERR = Object.freeze({
  code: '코드가 맞지 않거나 시간이 지났어요. 메일의 코드를 다시 확인하거나 새 코드를 받아 주세요.',
  short: '메일로 받은 6자리 코드를 적어 주세요.',
  sendCap: '지금은 확인 메일이 너무 많이 나갔어요. 잠시 뒤에 다시 해 주세요.',
  blocked: '지금은 이 주소로 확인 메일을 보낼 수 없어요. 구글로 연결해 주세요.',
  sendFail: '확인 메일을 보내지 못했어요. 주소를 확인하고 잠시 뒤에 다시 해 주세요.',
  mailExists: '이미 가입한 메일이에요. 로그인해 주세요.',
  idExists: '이미 가입한 아이디예요. 로그인해 주세요.',
  idSignup: '지금은 아이디로 새로 가입할 수 없어요. 이메일 주소로 가입하거나 구글로 연결해 주세요. 만들어 둔 아이디로는 로그인할 수 있어요.',
  idPending: '가입 확인이 끝나지 않은 아이디예요. 운영자에게 알려 주세요.',
  signup: '지금은 새 계정을 만들 수 없어요',
  none: '가입을 마치지 못했어요. 잠시 뒤에 다시 해 주세요.',
});
export function waitText(s) { return `${s}초 뒤에 다시 보낼 수 있어요.`; }

// Errors of the sign-up, the code and the code mail in Korean. email: the address of that attempt (an id gets the id wording).
// Anything else is the sign-in wording (authErrorText).
export function mailErrorText(e, { email = '' } = {}) {
  const code = String(e?.code || ''), m = String(e?.message || (typeof e === 'string' ? e : '') || '');
  const wait = retryAfterS(e);
  if (wait && (code === 'over_email_send_rate_limit' || /for security purposes/i.test(m))) return waitText(wait);
  if (code === 'otp_expired' || /token has expired or is invalid/i.test(m)) return MAIL_ERR.code;
  if (code === 'email_address_not_authorized' || /cannot be used as it is not authorized/i.test(m)) return MAIL_ERR.blocked;
  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(m)) return MAIL_ERR.sendCap;
  if (/error sending .*e-?mail/i.test(m)) return MAIL_ERR.sendFail;
  if (code === 'signup_disabled' || /signups? not allowed/i.test(m)) return MAIL_ERR.signup;
  if (code === 'user_already_exists' || code === 'email_exists' || /already (been )?registered/i.test(m)) return isMailbox(email) ? MAIL_ERR.mailExists : MAIL_ERR.idExists;
  return authErrorText(e);
}

// The page after the confirmation link of an older mail (?mail=1). arrived: oauthReturn() of that load. '' when there is nothing to say: no
// such link, or a session came with it (the link and its toast are the usual ones then).
export function mailArrival(mail, arrived, signedIn) {
  if (!mail || signedIn) return '';
  if (arrived?.failed) return '메일 링크가 만료됐거나 이미 쓰였어요. 이메일로 로그인하면 새 코드를 받을 수 있어요.';
  if (arrived?.code) return '메일 확인이 끝났어요. 가입하던 창에서 [확인하고 연결]을 누르거나, 여기서 로그인해 주세요.';
  return '';
}

// ---- the code step of the login sheet, as data ----
// ui.js keeps one view and paints codeView() of it; every change goes through codeStep(). via: 'up' (just signed up: the first mail went out
// with it) or 'in' (a sign-in found the address unconfirmed: no mail was sent now, the player may still have the one from the sign-up).
// sentAt: when the newest code mail went out (0: none from this sheet). busy: '' | 'verify' | 'resend'.
export const CODE_TITLE = '메일로 보낸 6자리 코드를 입력하세요';
const RECENT = '조금 전에 보낸 코드가 있어요. 그 메일의 코드를 넣어 주세요.';
export function codeStart({ email = '', via = 'up', wait = 0 } = {}, now = Date.now()) {
  const sent = via === 'up';
  // wait > 0: the sign-up was turned down because a code went out under a minute ago; that one is the code to type.
  return { email: String(email || ''), via: sent ? 'up' : 'in', sentAt: sent ? now - (CODE_WAIT_S - (wait > 0 ? wait : CODE_WAIT_S)) * 1000 : 0, busy: '', err: '', info: sent && wait > 0 ? RECENT : '', done: false };
}
export function codeStep(v, ev, now = Date.now()) {
  const t = ev?.t;
  if (!v || v.done) return v;
  if (t === 'verify') return v.busy ? v : { ...v, busy: 'verify', err: '', info: '' };
  if (t === 'verified') return { ...v, busy: '', err: '', done: true };
  if (t === 'fail') return { ...v, busy: '', err: String(ev.text || MAIL_ERR.none) };
  if (t === 'edit') return v.err && !v.busy ? { ...v, err: '' } : v; // typing again clears the line under the field
  if (t === 'resend') return v.busy || waitLeft(v.sentAt, now) > 0 ? v : { ...v, busy: 'resend', err: '', info: '' };
  if (t === 'sent') return { ...v, busy: '', err: '', sentAt: now, info: '새 코드를 보냈어요. 먼저 받은 코드는 이제 쓰지 못해요.' };
  // The server said how long to wait: a code mail went out under a minute ago (this sign-up's own, or one asked for in another tab). That
  // code is good, so it is a note, not an error, and the button counts the server's seconds down.
  if (t === 'wait') { const s = Math.max(1, Math.floor(Number(ev.s) || CODE_WAIT_S)); return { ...v, busy: '', err: '', sentAt: now - (CODE_WAIT_S - s) * 1000, info: RECENT }; }
  return v;
}
export function waitLeft(sentAt, now = Date.now(), s = CODE_WAIT_S) {
  if (!sentAt) return 0;
  return Math.max(0, Math.ceil((sentAt + s * 1000 - now) / 1000));
}
export function codeView(v, now = Date.now()) {
  const left = waitLeft(v?.sentAt, now);
  const busy = v?.busy || '';
  return {
    title: CODE_TITLE,
    // Until this sheet has mailed a code (a sign-in of an unconfirmed address), the address is the account's and the code is the sign-up's.
    lead: v?.sentAt
      ? '이 주소로 코드를 보냈어요. 메일이 보이지 않으면 스팸함도 확인해 주세요.'
      : '가입 확인이 아직 끝나지 않았어요. 가입할 때 메일로 받은 코드를 넣거나, 새 코드를 받으세요.',
    mailLabel: v?.sentAt ? '보낸 곳' : '가입한 주소',
    email: v?.email || '',
    submit: busy === 'verify' ? '확인하는 중…' : '확인하고 연결',
    submitOff: !!busy,
    resend: busy === 'resend' ? '보내는 중…' : left > 0 ? `코드 다시 보내기 (${left}초)` : v?.sentAt ? '코드 다시 보내기' : '새 코드 받기',
    resendOff: !!busy || left > 0,
    left,
    err: v?.err || '',
    info: v?.info || '',
  };
}
