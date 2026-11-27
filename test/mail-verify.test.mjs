// E-mail confirmation by a 6-digit code (Supabase "Confirm email"): the rules in mailcode.js, net.js's auth calls against a stub of
// supabase-js, main.js's sign-in paths run in a stub context, and source checks for the login sheet. Both settings are covered: confirmation
// off (signUp gives a session, today's path) and on (no session, a code by mail, typed in the same tab).
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_TITLE, CODE_WAIT_S, MAIL_ERR, codeStart, codeStep, codeView, confirmState, isMailbox, mailArrival, mailBack, mailErrorText, mailReturn,
  otpDigits, otpField, retryAfterS, signUpOutcome, unconfirmed, waitLeft, waitText,
} from '../mailcode.js';
import { authErrorText, cleanAddress, loginEmail, oauthReturn, returnUrl } from '../plaza-account.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a + ' … ' + b); return src.slice(i, j); };
const ORIGIN = 'https://studio.wishboard.workers.dev';
const plain = (v) => JSON.parse(JSON.stringify(v));

// Supabase's own answers (GoTrue), as supabase-js hands them over.
const ERR = {
  otp: { name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' },
  freq: { name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' },
  cap: { name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' },
  req: { name: 'AuthApiError', status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' },
  blocked: { name: 'AuthApiError', status: 400, code: 'email_address_not_authorized', message: 'Email address "a@b.com" cannot be used as it is not authorized' },
  send: { name: 'AuthApiError', status: 500, code: 'unexpected_failure', message: 'Error sending confirmation email' },
  pending: { name: 'AuthApiError', status: 400, code: 'email_not_confirmed', message: 'Email not confirmed' },
  creds: { name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' },
  exists: { name: 'AuthApiError', status: 422, code: 'user_already_exists', message: 'User already registered' },
  closed: { name: 'AuthApiError', status: 422, code: 'signup_disabled', message: 'Signups not allowed for this instance' },
  net: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
};

describe('mailcode.js rules', () => {
  it('tells a mailbox from an id stand-in address and reads the confirmation setting', () => {
    assert.equal(isMailbox('player@gmail.com'), true);
    assert.equal(isMailbox(' Player@Naver.com '), true);
    assert.equal(isMailbox(loginEmail('hero_01')), false); // hero_01@id.wishboard.dev
    assert.equal(isMailbox('HERO@ID.WISHBOARD.DEV'), false);
    for (const v of ['', 'nope', 'a@b', null, undefined]) assert.equal(isMailbox(v), false, String(v));
    assert.equal(confirmState({ mailer_autoconfirm: false, disable_signup: false }), 'on');
    assert.equal(confirmState({ mailer_autoconfirm: true }), 'off'); // the project today
    for (const v of [{}, null, undefined, 'x', { mailer_autoconfirm: 'false' }]) assert.equal(confirmState(v), '', JSON.stringify(v));
  });
  it('keeps only the digits of a typed or pasted code', () => {
    assert.equal(otpDigits('123456'), '123456');
    assert.equal(otpDigits(' 123 456 '), '123456');
    assert.equal(otpDigits('123-456'), '123456');
    assert.equal(otpDigits('１２３４５６'), '123456'); // a Korean keyboard's full-width digits
    assert.equal(otpDigits('12345678'), '12345678'); // Supabase allows 6 to 10
    for (const v of ['12345', '', null, 'abcdef', '12345678901']) assert.equal(otpDigits(v), '', String(v));
    assert.equal(otpField('12a3 4-5６789012'), '1234567890');
    assert.equal(otpField(null), '');
  });
  it('reads the wait out of the frequency limit and spots an unconfirmed sign-in', () => {
    assert.equal(retryAfterS(ERR.freq), 42);
    assert.equal(retryAfterS({ message: 'For security purposes, you can only request this after 1 second.' }), 1);
    assert.equal(retryAfterS(ERR.cap), 0);
    assert.equal(retryAfterS(null), 0);
    assert.equal(unconfirmed(ERR.pending), true);
    assert.equal(unconfirmed({ message: 'Email not confirmed' }), true); // an older server without a code
    assert.equal(unconfirmed(ERR.creds), false);
    assert.equal(unconfirmed(null), false);
  });
  it('sorts the answers of signUp in both settings', () => {
    const session = { access_token: 'a', user: { id: 'u' } };
    assert.deepEqual(signUpOutcome({ data: { user: session.user, session }, error: null }), { kind: 'session', session }); // confirmation off
    assert.deepEqual(signUpOutcome({ data: { user: { id: 'u', identities: [{ id: 'i' }] }, session: null }, error: null }), { kind: 'code', wait: 0 }); // on: mailed
    assert.deepEqual(signUpOutcome({ data: { user: { id: 'fake', identities: [] }, session: null }, error: null }), { kind: 'exists' }); // on: confirmed already
    assert.deepEqual(signUpOutcome({ data: { user: null, session: null }, error: ERR.freq }), { kind: 'code', wait: 42 }); // a code went out < 60 s ago
    assert.deepEqual(signUpOutcome({ data: { user: null, session: null }, error: ERR.cap }), { kind: 'error', error: ERR.cap });
    assert.deepEqual(signUpOutcome({ data: { user: null, session: null }, error: ERR.exists }), { kind: 'error', error: ERR.exists }); // off: an error
    assert.deepEqual(signUpOutcome({ data: { user: null, session: null }, error: null }), { kind: 'error', error: null });
    assert.deepEqual(signUpOutcome(null), { kind: 'error', error: null });
  });
  it('says every error of the code step in Korean, never in the server\'s words', () => {
    assert.equal(mailErrorText(ERR.otp), MAIL_ERR.code);
    assert.equal(mailErrorText(ERR.freq), waitText(42));
    assert.equal(waitText(42), '42초 뒤에 다시 보낼 수 있어요.');
    assert.equal(mailErrorText(ERR.cap), MAIL_ERR.sendCap);
    assert.equal(mailErrorText(ERR.blocked), MAIL_ERR.blocked); // the built-in mailer before custom SMTP: team addresses only
    assert.equal(mailErrorText(ERR.send), MAIL_ERR.sendFail);
    assert.equal(mailErrorText(ERR.closed), MAIL_ERR.signup);
    assert.equal(mailErrorText(ERR.exists, { email: 'a@b.com' }), MAIL_ERR.mailExists);
    assert.equal(mailErrorText(ERR.exists, { email: 'hero@id.wishboard.dev' }), MAIL_ERR.idExists);
    assert.equal(mailErrorText({ code: 'user_already_exists', message: 'User already registered' }), MAIL_ERR.idExists); // no address: the old wording
    assert.equal(mailErrorText(ERR.req), '요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.');
    assert.equal(mailErrorText(ERR.net), '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 해 주세요.');
    assert.equal(mailErrorText(ERR.creds), '아이디 또는 비밀번호가 맞지 않아요');
    assert.equal(mailErrorText({ code: 'no_code', message: '메일로 받은 6자리 코드를 적어 주세요.' }), '메일로 받은 6자리 코드를 적어 주세요.');
    assert.equal(mailErrorText(new Error('Something odd')), '로그인에 실패했어요');
    for (const e of Object.values(ERR)) assert.match(mailErrorText(e, { email: 'a@b.com' }), /[가-힣]/, e.message);
    // The sign-in wording itself is untouched.
    assert.equal(authErrorText(ERR.exists), '이미 가입한 아이디예요. 로그인해 주세요.');
  });
  it('marks the confirmation link and takes the mark out of the address with the other one-time parameters', () => {
    assert.equal(mailReturn(ORIGIN), ORIGIN + '/?mail=1');
    assert.equal(mailBack('?mail=1&code=abc'), true);
    assert.equal(mailBack('mail=1'), true);
    for (const s of ['', '?mail=0', '?email=1', '?code=abc']) assert.equal(mailBack(s), false, s);
    assert.equal(cleanAddress(ORIGIN + '/?mail=1&code=abc'), '/');
    assert.equal(cleanAddress(ORIGIN + '/?wish=abcdefghij&mail=1&error=access_denied&error_code=otp_expired#error=access_denied'), '/?wish=abcdefghij');
    assert.equal(returnUrl(ORIGIN + '/?mail=1&focus=PLOT_3'), ORIGIN + '/?focus=PLOT_3');
  });
  it('has one line for a confirmation link that came with no session', () => {
    const ok = oauthReturn('?mail=1&code=0b6c5a2e-7f1d-4c3b-9a8e-2d1f0e9c8b7a', '');
    const late = oauthReturn('?mail=1&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '#error=access_denied&error_code=otp_expired');
    assert.equal(mailArrival(true, ok, false), '메일 확인이 끝났어요. 가입하던 창에서 [확인하고 연결]을 누르거나, 여기서 로그인해 주세요.');
    assert.equal(mailArrival(true, late, false), '메일 링크가 만료됐거나 이미 쓰였어요. 이메일로 로그인하면 새 코드를 받을 수 있어요.');
    assert.equal(mailArrival(true, ok, true), ''); // the code verifier was here: signed in, the usual link toast
    assert.equal(mailArrival(false, ok, false), ''); // a Google return: the old lines
    assert.equal(mailArrival(true, oauthReturn('?mail=1', ''), false), ''); // nothing came with it
  });
});

describe('the code step as data (codeStart / codeStep / codeView)', () => {
  const T = 1_000_000;
  it('starts counting down after a sign-up, with the address and the title', () => {
    const v = codeStart({ email: 'a@b.com', via: 'up' }, T);
    const cv = codeView(v, T);
    assert.equal(cv.title, CODE_TITLE);
    assert.equal(CODE_TITLE, '메일로 보낸 6자리 코드를 입력하세요');
    assert.equal(cv.email, 'a@b.com');
    assert.equal(cv.lead, '이 주소로 코드를 보냈어요. 메일이 보이지 않으면 스팸함도 확인해 주세요.');
    assert.deepEqual([cv.submit, cv.submitOff, cv.resend, cv.resendOff, cv.left], ['확인하고 연결', false, `코드 다시 보내기 (${CODE_WAIT_S}초)`, true, CODE_WAIT_S]);
    assert.equal(codeView(v, T + 59_001).resend, '코드 다시 보내기 (1초)');
    assert.deepEqual([codeView(v, T + 60_000).resend, codeView(v, T + 60_000).resendOff], ['코드 다시 보내기', false]);
  });
  it('lets a sign-in of an unconfirmed address ask for a code at once', () => {
    const v = codeStart({ email: 'a@b.com', via: 'in' }, T);
    const cv = codeView(v, T);
    assert.equal(v.sentAt, 0);
    assert.deepEqual([cv.resend, cv.resendOff, cv.left, cv.mailLabel], ['새 코드 받기', false, 0, '가입한 주소']);
    assert.match(cv.lead, /가입 확인이 아직 끝나지 않았어요/);
    assert.equal(codeStart({ email: 'a@b.com', via: 'other' }, T).via, 'in');
    // Once this sheet mailed one, it says so.
    const sent = codeStep(codeStep(v, { t: 'resend' }, T), { t: 'sent' }, T);
    assert.deepEqual([codeView(sent, T).mailLabel, codeView(sent, T).lead], ['보낸 곳', '이 주소로 코드를 보냈어요. 메일이 보이지 않으면 스팸함도 확인해 주세요.']);
  });
  it('takes the wait the server gave, and points at the code that went out a moment ago', () => {
    const v = codeStart({ email: 'a@b.com', via: 'up', wait: 42 }, T);
    assert.equal(codeView(v, T).left, 42);
    assert.equal(codeView(v, T + 42_000).left, 0);
    assert.equal(codeView(v, T).info, '조금 전에 보낸 코드가 있어요. 그 메일의 코드를 넣어 주세요.');
    assert.equal(codeView(codeStart({ email: 'a@b.com', via: 'up' }, T), T).info, '');
  });
  it('verifies, fails, clears on typing, and is done once verified', () => {
    let v = codeStart({ email: 'a@b.com', via: 'up' }, T);
    v = codeStep(v, { t: 'verify' }, T);
    assert.deepEqual([v.busy, codeView(v, T).submit, codeView(v, T).submitOff, codeView(v, T + 61_000).resendOff], ['verify', '확인하는 중…', true, true]);
    assert.equal(codeStep(v, { t: 'verify' }, T), v, 'a second tap while one is out does nothing');
    assert.equal(codeStep(v, { t: 'resend' }, T + 61_000), v, 'no mail while a code is being checked');
    v = codeStep(v, { t: 'fail', text: MAIL_ERR.code }, T);
    assert.deepEqual([v.busy, codeView(v, T).err, codeView(v, T).submitOff], ['', MAIL_ERR.code, false]);
    v = codeStep(v, { t: 'edit' }, T);
    assert.equal(v.err, '');
    assert.equal(codeStep(v, { t: 'edit' }, T), v);
    assert.equal(codeStep(v, { t: 'fail' }, T).err, MAIL_ERR.none);
    v = codeStep(codeStep(v, { t: 'verify' }, T), { t: 'verified' }, T);
    assert.equal(v.done, true);
    assert.equal(codeStep(v, { t: 'fail', text: 'x' }, T), v, 'nothing after the end');
    assert.equal(codeStep(null, { t: 'verify' }), null);
    assert.equal(codeStep(codeStart({}, T), { t: 'unknown' }, T).busy, '');
  });
  it('sends another code only after the cooldown, then counts again', () => {
    let v = codeStart({ email: 'a@b.com', via: 'up' }, T);
    assert.equal(codeStep(v, { t: 'resend' }, T + 30_000), v, 'still counting down');
    v = codeStep(v, { t: 'resend' }, T + 60_000);
    assert.deepEqual([v.busy, codeView(v, T + 60_000).resend, codeView(v, T + 60_000).resendOff], ['resend', '보내는 중…', true]);
    v = codeStep(v, { t: 'sent' }, T + 61_000);
    assert.deepEqual([v.busy, v.sentAt, codeView(v, T + 61_000).left], ['', T + 61_000, CODE_WAIT_S]);
    assert.equal(codeView(v, T + 61_000).info, '새 코드를 보냈어요. 먼저 받은 코드는 이제 쓰지 못해요.');
    v = codeStep(v, { t: 'verify' }, T + 62_000);
    assert.equal(v.info, '', 'the note goes once the player goes on');
  });
  it('shows the server\'s own wait after a refused mail, and a plain failure without one', () => {
    let v = codeStep(codeStart({ email: 'a@b.com', via: 'in' }, T), { t: 'resend' }, T);
    v = codeStep(v, { t: 'wait', s: 42 }, T);
    assert.deepEqual([v.busy, codeView(v, T).left, codeView(v, T).err, codeView(v, T).info, codeView(v, T).resendOff], ['', 42, '', '조금 전에 보낸 코드가 있어요. 그 메일의 코드를 넣어 주세요.', true]);
    assert.equal(codeView(codeStep(v, { t: 'wait' }, T), T).left, CODE_WAIT_S);
    let w = codeStep(codeStart({ email: 'a@b.com', via: 'in' }, T), { t: 'resend' }, T);
    w = codeStep(w, { t: 'fail', text: MAIL_ERR.blocked }, T);
    assert.deepEqual([w.busy, w.sentAt, codeView(w, T).resendOff], ['', 0, false], 'nothing was sent: the button is back at once');
    assert.equal(waitLeft(0, T), 0);
  });
});

// ---- net.js against a stub of supabase-js -----------------------------------------------------------------------------------------------
globalThis.window ||= globalThis;
if (!globalThis.navigator?.userAgent) Object.defineProperty(globalThis, 'navigator', { value: { webdriver: false, onLine: true, userAgent: 'node' }, configurable: true });
globalThis.document ||= { hidden: false, addEventListener() {} };
globalThis.addEventListener ||= () => {};
globalThis.localStorage ||= { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
globalThis.sessionStorage ||= globalThis.localStorage;
globalThis.location ||= { search: '', hostname: 'studio.wishboard.workers.dev', href: ORIGIN + '/', origin: ORIGIN, protocol: 'https:' };
const { Net, SUPA_URL, SUPA_KEY } = await import('../net.js');

// confirm: Supabase "Confirm email". users: address -> { password, confirmed, code }.
function fakeAuth({ confirm = true, users = {} } = {}) {
  const calls = [];
  const sess = (email) => ({ access_token: 'tok-' + email, user: { id: 'id-' + email, email } });
  const auth = {
    calls,
    async signUp({ email, password, options }) {
      calls.push(['signUp', email, options?.emailRedirectTo]);
      const u = users[email];
      if (u?.confirmed) return confirm ? { data: { user: { id: 'fake', identities: [] }, session: null }, error: null } : { data: { user: null, session: null }, error: ERR.exists };
      if (u?.sentAt && Date.now() - u.sentAt < 60000) return { data: { user: null, session: null }, error: ERR.freq };
      if (!confirm) { users[email] = { password: u?.password || password, confirmed: true }; return { data: { user: sess(email).user, session: sess(email) }, error: null }; }
      users[email] = { password: u?.password || password, confirmed: false, code: '135790', sentAt: Date.now() };
      return { data: { user: { id: 'id-' + email, identities: [{ id: 'i' }] }, session: null }, error: null };
    },
    async signInWithPassword({ email, password }) {
      calls.push(['signIn', email]);
      const u = users[email];
      if (!u || u.password !== password) return { data: { user: null, session: null }, error: ERR.creds };
      if (!u.confirmed) return { data: { user: null, session: null }, error: ERR.pending };
      return { data: { user: sess(email).user, session: sess(email) }, error: null };
    },
    async verifyOtp(p) {
      calls.push(['verifyOtp', p.email, p.token, p.type]);
      const u = users[p.email];
      if (p.token === '429429') return { data: { user: null, session: null }, error: ERR.req };
      if (!u || u.confirmed || p.type !== 'signup' || p.token !== u.code) return { data: { user: null, session: null }, error: ERR.otp };
      u.confirmed = true;
      return { data: { user: sess(p.email).user, session: sess(p.email) }, error: null };
    },
    async updateUser(p) {
      calls.push(['updateUser', p.password]);
      return p.password === 'same-one' ? { data: { user: null }, error: { code: 'same_password', message: 'New password should be different from the old password.' } } : { data: {}, error: null };
    },
    async resend(p) { calls.push(['resend', p.type, p.email, p.options?.emailRedirectTo]); return { data: { user: null, session: null }, error: users[p.email]?.blocked ? ERR.blocked : null }; },
  };
  const net = new Net();
  net.sb = { auth };
  return { net, auth, calls, users };
}

describe('net.js: sign-up, sign-in, code and resend', () => {
  it('confirmation off: a sign-up gets its session at once, as today', async () => {
    const { net, calls } = fakeAuth({ confirm: false });
    const r = await net.passwordAuth('up', 'a@b.com', 'secret1');
    assert.equal(r.session.access_token, 'tok-a@b.com');
    assert.deepEqual(calls, [['signUp', 'a@b.com', ORIGIN + '/?mail=1']]);
    assert.equal((await net.passwordAuth('in', 'a@b.com', 'secret1')).session.user.id, 'id-a@b.com');
    await assert.rejects(net.passwordAuth('up', 'a@b.com', 'other12'), (e) => e.code === 'user_already_exists');
    await assert.rejects(net.passwordAuth('in', 'a@b.com', 'wrong12'), (e) => e.code === 'invalid_credentials');
  });
  it('confirmation on: a sign-up asks for the code, and the code gives the session that the existing path links', async () => {
    const { net, calls, users } = fakeAuth();
    assert.deepEqual(await net.passwordAuth('up', 'a@b.com', 'secret1'), { code: 'up', wait: 0 });
    assert.equal(users['a@b.com'].confirmed, false);
    // The same tap twice within a minute: the server will not mail again, the code step shows with its wait.
    assert.deepEqual(await net.passwordAuth('up', 'a@b.com', 'secret1'), { code: 'up', wait: 42 });
    const s = await net.verifyMail('a@b.com', '135 790', { password: 'secret1', setPassword: true });
    assert.equal(s.access_token, 'tok-a@b.com');
    assert.deepEqual(calls.filter((c) => c[0] === 'verifyOtp'), [['verifyOtp', 'a@b.com', '135790', 'signup']]);
    assert.deepEqual(calls.filter((c) => c[0] === 'updateUser'), [['updateUser', 'secret1']], 'the password typed at sign-up becomes the account\'s');
    await assert.rejects(net.passwordAuth('up', 'a@b.com', 'secret1'), (e) => e.code === 'user_already_exists', 'confirmed: the stand-in user means taken');
  });
  it('a sign-in of an unconfirmed address goes to the code step without mailing anything', async () => {
    const { net, calls } = fakeAuth({ users: { 'a@b.com': { password: 'secret1', confirmed: false, code: '246810' } } });
    assert.deepEqual(await net.passwordAuth('in', 'a@b.com', 'secret1'), { code: 'in', wait: 0 });
    assert.deepEqual(calls, [['signIn', 'a@b.com']]);
    await assert.rejects(net.passwordAuth('in', 'a@b.com', 'nope123'), (e) => e.code === 'invalid_credentials');
    const s = await net.verifyMail('a@b.com', '246810', { password: 'secret1', setPassword: false });
    assert.equal(s.user.email, 'a@b.com');
    assert.equal(calls.some((c) => c[0] === 'updateUser'), false, 'a sign-in keeps the password it was given');
  });
  it('a wrong code says so; a code that no longer passes still signs in when the address was confirmed another way', async () => {
    const { net, calls, users } = fakeAuth();
    await net.passwordAuth('up', 'a@b.com', 'secret1');
    await assert.rejects(net.verifyMail('a@b.com', '000000', { password: 'secret1', setPassword: true }), (e) => e.code === 'otp_expired');
    assert.deepEqual(calls.slice(-2).map((c) => c[0]), ['verifyOtp', 'signIn'], 'the password was tried once');
    // The link of an older mail, opened in another browser, confirmed the address; its code is used up.
    users['a@b.com'].confirmed = true;
    const s = await net.verifyMail('a@b.com', '135790', { password: 'secret1', setPassword: true });
    assert.equal(s.access_token, 'tok-a@b.com');
    // Nothing typed at all: the password alone, when it already works.
    assert.equal((await net.verifyMail('a@b.com', '', { password: 'secret1' })).access_token, 'tok-a@b.com');
  });
  it('nothing typed and not confirmed: asks for the code; a rate limit or the network: no second request', async () => {
    const { net, calls } = fakeAuth();
    await net.passwordAuth('up', 'a@b.com', 'secret1');
    await assert.rejects(net.verifyMail('a@b.com', '12', { password: 'secret1' }), (e) => e.code === 'no_code' && /6자리 코드/.test(e.message));
    const n = calls.length;
    await assert.rejects(net.verifyMail('a@b.com', '429429', { password: 'secret1' }), (e) => e.code === 'over_request_rate_limit');
    assert.deepEqual(calls.slice(n).map((c) => c[0]), ['verifyOtp']);
  });
  it('a password that is already the account\'s is fine after the code', async () => {
    const { net } = fakeAuth();
    await net.passwordAuth('up', 'a@b.com', 'same-one');
    assert.equal((await net.verifyMail('a@b.com', '135790', { password: 'same-one', setPassword: true })).access_token, 'tok-a@b.com');
  });
  it('resends a signup code with the return address, and hands the server\'s refusal on', async () => {
    const { net, calls, users } = fakeAuth();
    assert.equal(await net.resendMail('a@b.com'), true);
    assert.deepEqual(calls, [['resend', 'signup', 'a@b.com', ORIGIN + '/?mail=1']]);
    users['x@y.com'] = { blocked: true };
    await assert.rejects(net.resendMail('x@y.com'), (e) => e.code === 'email_address_not_authorized');
  });
  it('asks Supabase once per page whether the confirmation is on, and again only when it could not tell', async () => {
    const real = globalThis.fetch, seen = [];
    let answer = { mailer_autoconfirm: false };
    globalThis.fetch = async (url, init) => { seen.push([url, init?.headers?.apikey]); if (answer === 'down') throw new TypeError('Failed to fetch'); return { ok: true, json: async () => answer }; };
    try {
      const net = new Net();
      assert.equal(await net.mailConfirm(), 'on');
      assert.equal(await net.mailConfirm(), 'on');
      assert.deepEqual(seen, [[SUPA_URL + '/auth/v1/settings', SUPA_KEY]]);
      const other = new Net();
      answer = 'down';
      assert.equal(await other.mailConfirm(), '');
      answer = { mailer_autoconfirm: true };
      assert.equal(await other.mailConfirm(), 'off');
      assert.equal(seen.length, 3);
    } finally { globalThis.fetch = real; }
  });
  it('throws a plain line before the client is there', async () => {
    const net = new Net();
    await assert.rejects(net.passwordAuth('up', 'a@b.com', 'secret1'), /로그인 준비 중이에요/);
    await assert.rejects(net.verifyMail('a@b.com', '135790', {}), /로그인 준비 중이에요/);
    await assert.rejects(net.resendMail('a@b.com'), /로그인 준비 중이에요/);
  });
});

// ---- main.js: passwordSign, mailCodeSign, mailCodeResend and bootAccount in a stub context ------------------------------------------
function mainFlow({ confirm = 'on', users = {} } = {}) {
  const src = between(read('main.js'), '\nasync function passwordSign(', '\n// ---- one actor per window');
  const fake = fakeAuth({ confirm: confirm === 'on', users });
  const calls = { ops: 0, finishLink: [], mailConfirm: 0 };
  fake.net.mailConfirm = async () => { calls.mailConfirm += 1; return confirm; };
  const ctx = {
    loginEmail, isMailbox, mailErrorText, retryAfterS, MAIL_ERR, Promise, Object, Error, String,
    net: fake.net,
    actorOp: async (run) => { calls.ops += 1; return run(); },
    finishLink: async (session, fresh) => { calls.finishLink.push([session.user.id, fresh]); },
  };
  runInNewContext(src + '\nthis.passwordSign = passwordSign; this.mailCodeSign = mailCodeSign; this.mailCodeResend = mailCodeResend;', ctx);
  return { ...ctx, calls, fake };
}

describe('main.js sign-in paths (stubbed)', () => {
  it('confirmation off: an e-mail or an id sign-up links at once, as before', async () => {
    const m = mainFlow({ confirm: 'off' });
    assert.equal(await m.passwordSign('up', 'a@b.com', 'secret1'), null);
    assert.equal(await m.passwordSign('up', 'hero_01', 'secret1'), null);
    assert.deepEqual(m.calls.finishLink, [['id-a@b.com', true], ['id-hero_01@id.wishboard.dev', true]]);
    assert.equal(m.calls.ops, 2);
  });
  it('confirmation on: a sign-up answers with the code step, and the code links in this tab through finishLink', async () => {
    const m = mainFlow();
    const next = await m.passwordSign('up', ' A@B.com ', 'secret1');
    assert.deepEqual(plain(next), { email: 'a@b.com', via: 'up', wait: 0 });
    assert.deepEqual(m.calls.finishLink, [], 'no session yet: nothing is linked');
    await assert.rejects(m.mailCodeSign('a@b.com', '111111', 'secret1', 'up'), { message: MAIL_ERR.code });
    await m.mailCodeSign('a@b.com', '135790', 'secret1', 'up');
    assert.deepEqual(m.calls.finishLink, [['id-a@b.com', true]]);
    assert.equal(m.calls.ops, 3, 'every path that changes who this window is runs as an actorOp');
    assert.deepEqual(m.fake.calls.filter((c) => c[0] === 'updateUser'), [['updateUser', 'secret1']]);
  });
  it('confirmation on: no id sign-up (no mailbox), and an unconfirmed id cannot take the code step', async () => {
    const m = mainFlow({ users: { 'old_id@id.wishboard.dev': { password: 'secret1', confirmed: false, code: '1' } } });
    await assert.rejects(m.passwordSign('up', 'hero_01', 'secret1'), { message: MAIL_ERR.idSignup });
    assert.deepEqual(m.fake.calls, [], 'nothing reached Supabase, so no mail bounced');
    await assert.rejects(m.passwordSign('in', 'old_id', 'secret1'), { message: MAIL_ERR.idPending });
    // A confirmed id still signs in.
    m.fake.users['hero_02@id.wishboard.dev'] = { password: 'secret1', confirmed: true };
    assert.equal(await m.passwordSign('in', 'hero_02', 'secret1'), null);
  });
  it('the setting unknown: an id sign-up is tried, and stopped with the same line if no session comes', async () => {
    const m = mainFlow({ confirm: '' });
    m.net.passwordAuth = async () => ({ code: 'up', wait: 0 });
    await assert.rejects(m.passwordSign('up', 'hero_01', 'secret1'), { message: MAIL_ERR.idSignup });
  });
  it('a sign-in of an unconfirmed address offers the code step; taken addresses and bad input say so', async () => {
    const m = mainFlow({ users: { 'a@b.com': { password: 'secret1', confirmed: false, code: '246810' } } });
    assert.deepEqual(plain(await m.passwordSign('in', 'a@b.com', 'secret1')), { email: 'a@b.com', via: 'in', wait: 0 });
    m.fake.users['c@d.com'] = { password: 'x', confirmed: true };
    await assert.rejects(m.passwordSign('up', 'c@d.com', 'secret1'), { message: MAIL_ERR.mailExists });
    await assert.rejects(m.passwordSign('up', 'no', 'secret1'), { message: '이메일 또는 아이디를 확인해 주세요' });
    await assert.rejects(m.passwordSign('up', 'a@b.com', '123'), { message: '비밀번호는 6자 이상이어야 해요' });
  });
  it('resend errors come back in Korean, with the wait when the server named one', async () => {
    const m = mainFlow();
    m.net.resendMail = async () => { throw ERR.freq; };
    await assert.rejects(m.mailCodeResend('a@b.com'), (e) => e.message === waitText(42) && e.wait === 42);
    m.net.resendMail = async () => { throw ERR.blocked; };
    await assert.rejects(m.mailCodeResend('a@b.com'), (e) => e.message === MAIL_ERR.blocked && e.wait === 0);
    m.net.resendMail = async () => true;
    assert.equal(await m.mailCodeResend('a@b.com'), undefined);
  });
});

function boot({ search = '', hash = '', session = null } = {}) {
  const src = between(read('main.js'), 'async function bootAccount() {', '\n// ---- Google sign-in in a second window');
  const calls = { notes: [], finishLink: [], opened: 0, account: [] };
  const q = new URLSearchParams(search);
  const ctx = {
    SIGN_BACK: { ask: q.get('login') === '1', to: q.get('back') || '', went: false }, // main.js's ?login=1 (a board page's 계정에 남겨 두기)
    URLSearchParams, mailArrival, cleanAddress, oauthErrorText: () => 'OAUTH-ERR',
    ARRIVED: oauthReturn(search, hash), MAIL_BACK: mailBack(search),
    location: { search, hash, href: ORIGIN + '/' + search + hash, pathname: '/' },
    history: { state: null, replaceState() {} },
    net: { currentSession: async () => session },
    finishLink: async (s, fresh) => { calls.finishLink.push([s.user.id, fresh]); },
    ui: { setAccount: (v) => calls.account.push(v), note: (text, kind, tap) => calls.notes.push([text, kind, typeof tap]), openLogin: (o) => { calls.opened += 1; calls.loginOpts = o; } },
  };
  runInNewContext(src + '\nthis.bootAccount = bootAccount;', ctx);
  return { run: () => ctx.bootAccount(), calls, ctx };
}

describe('main.js bootAccount: back from a confirmation link of an older mail', () => {
  const CODE = '0b6c5a2e-7f1d-4c3b-9a8e-2d1f0e9c8b7a';
  it('in the browser that signed up (its code verifier is here): signed in, and the usual link path runs', async () => {
    const b = boot({ search: '?mail=1&code=' + CODE, session: { user: { id: 'u-1' } } });
    await b.run();
    assert.deepEqual(b.calls.finishLink, [['u-1', true]]);
    assert.deepEqual(b.calls.notes, []);
  });
  it('in another browser: the address is confirmed, one line says where to go on, and a tap opens the sheet', async () => {
    const b = boot({ search: '?mail=1&code=' + CODE });
    await b.run();
    assert.deepEqual(b.calls.notes, [['메일 확인이 끝났어요. 가입하던 창에서 [확인하고 연결]을 누르거나, 여기서 로그인해 주세요.', 'ok', 'function']]);
    assert.deepEqual(b.calls.finishLink, []);
  });
  it('an expired link: its own line, not the Google one', async () => {
    const b = boot({ search: '?mail=1&error=access_denied&error_code=otp_expired', hash: '#error=access_denied&error_code=otp_expired' });
    await b.run();
    assert.deepEqual(b.calls.notes, [['메일 링크가 만료됐거나 이미 쓰였어요. 이메일로 로그인하면 새 코드를 받을 수 있어요.', 'err', 'function']]);
  });
  it('?login=1 (계정에 남겨 두기 on a board page) opens the sheet for a browser with no session, never for a signed-in one', async () => {
    const b = boot({ search: '?login=1&back=%2Fg%2Fabcd1234' });
    await b.run(); assert.equal(b.calls.opened, 1);
    assert.equal(b.ctx.SIGN_BACK.to, '/g/abcd1234');
    b.calls.loginOpts.onClose(); assert.equal(b.ctx.SIGN_BACK.to, '', 'the sheet closed without a sign-in: a later sign-in stays in the plaza');
    assert.match(read('ui.js'), /try \{ opts\?\.onClose\?\.\(\); \} catch/, 'the sheet calls it when it closes');
    const s = boot({ search: '?login=1', session: { user: { id: 'u-1' } } });
    await s.run(); assert.equal(s.calls.opened, 0);
    const n = boot({ search: '' });
    await n.run(); assert.equal(n.calls.opened, 0);
  });
  it('a Google return keeps its old lines', async () => {
    const b = boot({ search: '?code=' + CODE });
    await b.run();
    assert.deepEqual(b.calls.notes, [['로그인을 마치지 못했어요. 다시 시도해 주세요.', 'err', 'undefined']]);
    const e = boot({ search: '?error=access_denied' });
    await e.run();
    assert.deepEqual(e.calls.notes, [['OAUTH-ERR', 'err', 'undefined']]);
  });
});

describe('the login sheet and the page (source checks)', () => {
  const ui = read('ui.js'), main = read('main.js'), net = read('net.js');
  const login = between(ui, '  function openLogin(opts) {', '\n  // In-app browser, back from the system browser');
  it('has a numeric one-time-code field, the address, a resend with its countdown, and a way back', () => {
    assert.match(login, /inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '\[0-9\]\*', maxLength: 10/);
    assert.match(login, /codeMail\.replaceChildren\(cv\.mailLabel \+ ' ', h\('b', \{ text: cv\.email \}\)\);/);
    assert.match(login, /codeAgain\.disabled = cv\.resendOff;/);
    assert.match(login, /tick = setInterval\(paintCode, 1000\)/);
    assert.match(login, /return \(\) => \{ if \(loginPaint === paint\) loginPaint = null; clearInterval\(tick\); tick = 0; try \{ opts\?\.onClose\?\.\(\); \}/); // onClose: ?login=1&back= (2026-11-28)
    assert.match(login, /await hooks\.mailCode\?\.\(k\.v\.email, codeIn\.value, k\.pw, k\.v\.via\);/);
    assert.match(login, /await hooks\.mailResend\?\.\(email\);/);
    assert.match(login, /text: '다른 주소로 하기'/);
    assert.match(login, /if \(codeKeep\) showCode\(true\);/);
  });
  it('switches to the code step only when the sign-in path asks for it, and asks Supabase whether the confirmation is on', () => {
    assert.match(login, /const next = await hooks\.passwordAuth\?\.\(mode, id\.value, pw\.value\);\n\s+if \(next\?\.email\) \{/);
    assert.match(login, /codeKeep = \{ v: codeStart\(next\), pw: pw\.value \};/);
    assert.match(login, /const asked = hooks\.mailConfirm\?\.\(\);/);
    assert.match(login, /const label = up && mailOnly \? '이메일 주소' : '이메일 또는 아이디';/);
  });
  it('wires the hooks to main.js paths that run as actorOps and end in finishLink', () => {
    assert.match(main, /mailCode: \(email, code, password, via\) => mailCodeSign\(email, code, password, via\),/);
    assert.match(main, /mailResend: \(email\) => mailCodeResend\(email\),/);
    assert.match(main, /mailConfirm: \(\) => net\.mailConfirm\(\),/);
    const sign = between(main, 'async function mailCodeSign(', '\nasync function mailCodeResend(');
    assert.match(sign, /await actorOp\(async \(\) => \{/);
    assert.match(sign, /await finishLink\(session, true\);/);
    assert.ok(main.indexOf('const MAIL_BACK = mailBack(location.search);') < main.indexOf('const net = new Net();'), 'read before supabase-js sees the address');
  });
  it('net.js uses the supabase-js v2 calls as documented', () => {
    assert.match(net, /auth\.signUp\(\{ email, password, options: \{ emailRedirectTo: mailReturn\(location\.origin\) \} \}\)/);
    assert.match(net, /auth\.verifyOtp\(\{ email, token: code, type: 'signup' \}\)/);
    assert.match(net, /auth\.resend\(\{ type: 'signup', email, options: \{ emailRedirectTo: mailReturn\(location\.origin\) \} \}\)/);
    assert.match(net, /fetch\(SUPA_URL \+ '\/auth\/v1\/settings', \{ headers: \{ apikey: SUPA_KEY \}/);
    assert.match(read('index.html'), /"@supabase\/supabase-js": "https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\/\+esm"/);
  });
});
