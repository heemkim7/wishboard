// migrations/2026-11-22-coins.sql, run for real: the schema before it (git show aef1e9f:schema.sql) with a stand-in for Supabase's auth schema,
// then the file, then what the database does on its own. The Worker's side of both states is in test/merge-guard.test.mjs and
// test/forget-login.test.mjs. Needs PGlite outside the repo (see test/db.test.mjs for how); skipped without it.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIG = 'migrations/2026-11-22-coins.sql';
async function loadPGlite() {
  for (const d of [process.env.PGLITE_DIR, join(tmpdir(), 'kts-pglite')].filter(Boolean)) {
    try { const req = createRequire(join(d, 'package.json')); return (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; } catch { }
  }
  try { return (await import('@electric-sql/pglite')).PGlite; } catch { return null; }
}
const PGlite = await loadPGlite();
const OLD = (() => { try { return execFileSync('git', ['show', 'aef1e9f:schema.sql'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'); } catch { return null; } })();
const SKIP = !PGlite ? 'PGlite not installed (see test/db.test.mjs)' : !OLD ? 'git show aef1e9f:schema.sql not available' : false;
const KEY = 'pglite-coins-key';
// The columns of auth.users this file and its part 2 touch, and the two tables forget_login's cascade reaches.
const AUTH = `CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, is_anonymous boolean NOT NULL DEFAULT false, deleted_at timestamptz);
  CREATE TABLE auth.identities (id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
  CREATE TABLE auth.sessions (id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);`;
async function make(schemaText) {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;' + AUTH);
  await db.exec(schemaText);
  await db.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']);
  return db;
}
let seq = 0;
const uuid = () => 'c0c0c0c0-0000-4000-8000-' + String(++seq).padStart(12, '0');
const gid = () => 'guest:g-' + 'abcdef01-0000-4000-8000-' + String(++seq).padStart(12, '0');
function api(db) {
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const r = async (name, args) => { const keys = Object.keys(args); return (await one('SELECT public.' + name + '(' + keys.map((k, i) => k + ' => $' + (i + 1) + (k === 'p_items' ? '::jsonb' : '')).join(', ') + ') AS r', keys.map((k) => (k === 'p_items' ? JSON.stringify(args[k]) : args[k])))).r; };
  return {
    one, r,
    login: async (email, more = {}) => { const id = uuid(); await db.query('INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data, is_anonymous) VALUES ($1, $2, $3, $4, $5)', [id, email || null, more.unconfirmed ? null : new Date().toISOString(), JSON.stringify({ provider: more.provider || 'email' }), !!more.anon]); return 'user:' + id; },
    guest: async (coins = 140) => { const g = gid(); await db.query('INSERT INTO public.wallets (actor_id, coins) VALUES ($1, $2)', [g, coins]); return g; },
    coins: async (id) => { const row = await one('SELECT coins::int c FROM public.wallets WHERE actor_id = $1', [id]); return row ? row.c : null; },
    merge: (u, g) => r('merge_guest_account', { p_key: KEY, p_user_id: u, p_guest_id: g, p_nickname: '' }),
    withdraw: (u) => r('withdraw_account', { p_key: KEY, p_actor_id: u }),
    forget: (u) => r('forget_login', { p_key: KEY, p_actor_id: u }),
    marks: async () => (await db.query('SELECT h FROM public.gone_logins ORDER BY h')).rows.map((x) => x.h),
  };
}
const status = async (db) => (await db.exec(read(MIG))).at(-1).rows;

describe('coins migration on the schema before it', { skip: SKIP, concurrency: false }, () => {
  let db, a;
  before(async () => { db = await make(OLD); a = api(db); });

  it('before: the merge moves every coin and says moved; nothing in the database keeps the arrival coins or a withdrawal', async () => {
    const u = await a.login('before@example.com'); await a.merge(u, await a.guest()); const g = await a.guest(), m = await a.merge(u, g);
    assert.equal(m.moved, 140); assert.equal('guard' in m, false); assert.equal(await a.coins(u), 580); // 140 + 300 + 140: the Worker had to take 140 back after the call
    assert.equal((await a.one("SELECT to_regclass('public.gone_logins') IS NULL AS no")).no, true);
    // What the Worker's send floor (580) has to cover before the file: an account row made before its first link starts at the column's 100.
    const early = await a.login('early@example.com'); assert.equal((await a.r('profile_read', { p_key: KEY, p_actor_id: early })).ok, true); assert.equal(await a.coins(early), 100);
    assert.equal((await a.merge(early, await a.guest())).coins, 540); // 100 + 140 + 300
  });

  it('applies in one go, reports the old unconfirmed sign-ups in its one result row, and can run again without change', async () => {
    await a.login('old.signup@id.wishboard.dev', { unconfirmed: true }); await a.login('old.mail@example.com', { unconfirmed: true });
    await a.login('google@example.com', { unconfirmed: true, provider: 'google' }); await a.login('', { unconfirmed: true, anon: true }); // not part 2's
    const NAMES = "('merge_guest_account','sell_coins_to_advertiser','gone_hash','wallets_gone_mark','wallets_need_login','profile_read','set_nickname','set_ring_color','touch_attend','create_tribe','join_tribe')";
    const defs = async () => (await db.query("SELECT p.proname, pg_get_functiondef(p.oid) def, p.proacl::text acl FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN " + NAMES + " ORDER BY 1")).rows;
    const salt = async () => (await a.one("SELECT key_value v FROM public.app_secrets WHERE key_name = 'GONE_SALT'"))?.v;
    const rows = await status(db);
    assert.equal(rows.length, 1); assert.deepEqual(Object.keys(rows[0]), ['applied', 'note']);
    assert.equal(rows[0].applied, true, rows[0].note); assert.match(rows[0].note, /^적용됨\./); assert.match(rows[0].note, /메일 확인이 안 끝난 옛 가입 2개/);
    const d1 = await defs(), s1 = await salt(); assert.match(s1, /^[0-9a-f]{64}$/);
    const again = await status(db); assert.equal(again[0].applied, true);
    assert.deepEqual(await defs(), d1); assert.equal(await salt(), s1); // the salt is made once and never replaced
    // The same functions, grants and tables as a database made from schema.sql.
    const neu = await make(read('schema.sql'));
    try {
      // profile_read differs from schema.sql only by its two list limits (migrations/2026-11-22-shop.sql: 4 -> 6 equipped, 12 -> 16 owned).
      const nd = (await neu.query("SELECT p.proname, pg_get_functiondef(p.oid) def, p.proacl::text acl FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN " + NAMES + " ORDER BY 1")).rows
        .map((f) => (f.proname === 'profile_read' ? { ...f, def: f.def.replace(/LIMIT 6\b/, 'LIMIT 4').replace(/LIMIT 16\b/, 'LIMIT 12') } : f));
      assert.deepEqual(d1, nd); assert.equal(d1.length, 11); // the six patched in place come out exactly as schema.sql writes them
      // save_species differs from schema.sql only by the species range (migrations/2026-11-22-species.sql); the wallet check is the same.
      const sp = async (d) => (await d.query("SELECT pg_get_functiondef('public.save_species(text,text,integer)'::regprocedure) AS d")).rows[0].d.replace(/v_species := CASE[^\n]*\n/, '');
      assert.equal(await sp(db), await sp(neu));
      const trig = async (d) => (await d.query("SELECT tgname, tgtype FROM pg_trigger WHERE tgrelid = 'public.wallets'::regclass AND NOT tgisinternal ORDER BY 1")).rows;
      assert.deepEqual(await trig(db), await trig(neu)); assert.deepEqual((await trig(db)).map((x) => x.tgname), ['wallets_gone_mark', 'wallets_need_login']);
    } finally { await neu.close(); }
    for (const t of ['gone_logins', 'starter_taken']) assert.equal((await a.one('SELECT relrowsecurity r FROM pg_class WHERE oid = $1::regclass', ['public.' + t])).r, true, t);
    assert.doesNotMatch(d1.find((f) => f.proname === 'gone_hash').acl, /(^|[{,])(=|anon=|authenticated=|service_role=)X/); // nobody outside the database can call it
  });

  it('after: a later link leaves the guest\'s arrival coins out in the same step; the first link keeps everything and pays 300 once', async () => {
    const u = await a.login('after@example.com'), g1 = await a.guest(180);
    const first = await a.merge(u, g1);
    assert.deepEqual([first.ok, first.bonus, first.back, first.again, first.guard, first.coins, 'moved' in first], [true, 300, 0, false, 2, 480, false]);
    assert.equal((await a.one('SELECT taken FROM public.starter_taken WHERE guest_id = $1', [g1])).taken, 140);
    assert.equal((await a.merge(u, g1)).coins, 480); // a replay
    const g2 = await a.guest(200), m2 = await a.merge(u, g2); assert.deepEqual([m2.bonus, m2.back, m2.moved_in, m2.coins], [0, 140, 200, 540]);
    const g3 = await a.guest(90), m3 = await a.merge(u, g3); assert.deepEqual([m3.back, m3.coins], [90, 540]); // spent 50 of its 140: adds nothing
    await db.query('UPDATE public.wallets SET coins = coins + 70 WHERE actor_id = $1', [g3]); // a late flush to it
    const m4 = await a.merge(u, g3); assert.deepEqual([m4.back, m4.coins], [50, 560]); // 50 of its arrival coins were still unmoved: 20 is earned
    for (const g of [g1, g2, g3]) assert.equal(await a.coins(g), 0);
    assert.deepEqual(await a.merge('probe', 'probe'), { ok: false, error: '계정 정보가 올바르지 않습니다.', guard: 2 }); // what the Worker's probe sees
  });

  it('after: a first link counts only the arrival coins it really moved, so an empty guest linked by a throwaway account gives nobody 140 later', async () => {
    const main = await a.login('main@example.com'); await a.merge(main, await a.guest()); assert.equal(await a.coins(main), 440);
    // A throwaway account links a guest that has no wallet row yet (or an empty one): nothing moved, nothing counted.
    const throwaway = await a.login('throwaway@example.com'), g = gid(), t = await a.merge(throwaway, g);
    assert.deepEqual([t.bonus, t.moved_in, t.coins], [300, 0, 300]); assert.equal((await a.one('SELECT taken FROM public.starter_taken WHERE guest_id = $1', [g])).taken, 0);
    await db.query('INSERT INTO public.wallets (actor_id, coins) VALUES ($1, 140)', [g]); // the guest's row is made now: 100 + its hello 40
    const m = await a.merge(main, g); assert.deepEqual([m.back, m.coins], [140, 440]); // held back whole: nothing reaches the main account
    // A first link that moved part of the arrival coins counts that part; the rest is held back from the guest's next link.
    const other = await a.login('other@example.com'), g2 = await a.guest(50), f = await a.merge(other, g2);
    assert.deepEqual([f.bonus, f.coins], [300, 350]); assert.equal((await a.one('SELECT taken FROM public.starter_taken WHERE guest_id = $1', [g2])).taken, 50);
    await db.query('UPDATE public.wallets SET coins = 140 WHERE actor_id = $1', [g2]); const m2 = await a.merge(main, g2);
    assert.deepEqual([m2.back, m2.coins], [90, 490]); // 90 of its arrival coins were never moved: 50 above them reach the account
  });

  it('after: an account row made outside the link starts at 0, so a fresh account holds at most its first guest\'s coins and the 300', async () => {
    const u = await a.login('profile.first@example.com');
    assert.equal((await a.r('profile_read', { p_key: KEY, p_actor_id: u })).ok, true); assert.equal(await a.coins(u), 0); // before: 100
    const m = await a.merge(u, await a.guest()); assert.deepEqual([m.bonus, m.coins], [300, 440]);
    // A room flush that makes the row: only what it carries.
    const v = await a.login('flush.first@example.com'); await a.r('coin_batch', { p_key: KEY, p_items: [{ actor_id: v, nickname: '', delta: 40, reason: 'bonus' }] }); assert.equal(await a.coins(v), 40);
    const w = await a.login('species.first@example.com'); assert.equal((await a.r('save_species', { p_key: KEY, p_actor_id: w, p_species: 2 })).ok, true); assert.equal(await a.coins(w), 0);
    const nk = await a.login('nick.first@example.com'); assert.equal((await a.r('set_nickname', { p_key: KEY, p_actor_id: nk, p_nickname: '이름' })).ok, true); assert.equal(await a.coins(nk), 0);
    // A row that is already there keeps its coins, also through an INSERT ... ON CONFLICT that adds EXCLUDED (a flush, a refund).
    await a.r('coin_batch', { p_key: KEY, p_items: [{ actor_id: v, nickname: '', delta: 25, reason: 'mine' }] }); assert.equal(await a.coins(v), 65);
    await a.r('profile_read', { p_key: KEY, p_actor_id: v }); assert.equal(await a.coins(v), 65);
    // An anonymous sign-in cannot link, so its row keeps the 100; guests are untouched.
    const anon = await a.login('', { anon: true }); await a.r('profile_read', { p_key: KEY, p_actor_id: anon }); assert.equal(await a.coins(anon), 100);
    const g = gid(); await a.r('profile_read', { p_key: KEY, p_actor_id: g }); assert.equal(await a.coins(g), 100);
    // A login re-joined after a withdrawal: no start coins of its own, no reward, and its guest's arrival coins stay out.
    const r = await a.login('rejoin@example.com'); await a.merge(r, await a.guest()); await a.withdraw(r); await a.forget(r);
    const r2 = await a.login('rejoin@example.com'); await a.r('profile_read', { p_key: KEY, p_actor_id: r2 }); assert.equal(await a.coins(r2), 0);
    const again = await a.merge(r2, await a.guest(160)); assert.deepEqual([again.again, again.bonus, again.coins], [true, 0, 20]);
  });

  it('a withdrawal leaves two salted marks; the same e-mail on a new id gets no second 300, another e-mail does; a key rotation forgets nothing', async () => {
    const u = await a.login('Twice.Person@Example.com'); await a.merge(u, await a.guest());
    const before = (await a.marks()).length;
    assert.equal((await a.withdraw(u)).ok, true); assert.deepEqual(await a.forget(u), { ok: true, deleted: 1 });
    const marks = await a.marks(); assert.equal(marks.length - before, 2);
    for (const h of marks) assert.match(h, /^[0-9a-f]{32}$/);
    assert.equal(JSON.stringify(marks).includes(u.slice(5)), false);
    await db.query("UPDATE public.app_secrets SET key_value = 'rotated' WHERE key_name = 'FLUSH_KEY'"); // FLUSH_KEY (and GUEST_KEY, a Worker secret) can change
    const k2 = 'rotated', merge2 = (x, g) => a.r('merge_guest_account', { p_key: k2, p_user_id: x, p_guest_id: g, p_nickname: '' });
    const v = await a.login('twice.person@EXAMPLE.com'), g = await a.guest(165), m = await merge2(v, g);
    assert.deepEqual([m.bonus, m.again, m.back, m.coins], [0, true, 140, 25]);
    assert.equal((await merge2(v, await a.guest(150))).again, false); // the account is linked now: later links are ordinary
    const w = await a.login('someone.else@example.com'), mw = await merge2(w, await a.guest());
    assert.deepEqual([mw.bonus, mw.again, mw.coins], [300, false, 440]);
    await db.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']);
  });

  it('no login, no wallet: the withdrawn id\'s token cannot make a wallet, and a batch around it still pays everybody else', async () => {
    const u = await a.login('gone.token@example.com'); await a.merge(u, await a.guest());
    await a.withdraw(u); await a.forget(u);
    // No wallet row, so no profile row either: the functions that make one on their way say so instead of failing on the foreign key.
    const LOGIN = { ok: false, error: 'login' };
    assert.deepEqual(await a.r('profile_read', { p_key: KEY, p_actor_id: u }), LOGIN);
    assert.deepEqual(await a.r('save_species', { p_key: KEY, p_actor_id: u, p_species: 2 }), LOGIN);
    assert.deepEqual(await a.r('set_nickname', { p_key: KEY, p_actor_id: u, p_nickname: '이름' }), LOGIN);
    assert.deepEqual(await a.r('set_ring_color', { p_key: KEY, p_actor_id: u, p_color: '#112233' }), LOGIN);
    assert.deepEqual(await a.r('touch_attend', { p_key: KEY, p_actor_id: u }), LOGIN);
    assert.deepEqual(await a.r('create_tribe', { p_key: KEY, p_actor_id: u, p_id: 'gonetrb1', p_tag: 'GONE' }), LOGIN);
    assert.equal((await a.one("SELECT count(*)::int n FROM public.tribes WHERE id = 'gonetrb1'")).n, 0);
    const owner = await a.login('tribe.owner@example.com'); assert.equal((await a.r('create_tribe', { p_key: KEY, p_actor_id: owner, p_id: 'livetrb1', p_tag: 'LIVE' })).ok, true);
    assert.deepEqual(await a.r('join_tribe', { p_key: KEY, p_actor_id: u, p_id: 'livetrb1' }), LOGIN);
    assert.equal(await a.coins(u), null);
    const g = await a.guest(100), batch = await a.r('coin_batch', { p_key: KEY, p_items: [{ actor_id: u, nickname: '', delta: 300, reason: 'mine' }, { actor_id: g, nickname: '', delta: 7, reason: 'mine' }] });
    assert.equal(batch.ok, true); assert.equal(await a.coins(u), null); assert.equal(await a.coins(g), 107);
    const m = await a.merge(u, g); assert.deepEqual(m, { ok: false, error: '로그인 정보를 찾지 못했어요. 다시 로그인해 주세요.', guard: 2 }); assert.equal(await a.coins(g), 107);
    // A send from it: refused before the board holder is paid (the function used to read a missing row as enough coins).
    const holder = await a.login('holder@example.com'); await a.merge(holder, await a.guest());
    await db.query("UPDATE public.billboards SET holder_id = $1, holder_name = '주인', lit_until = now() + interval '1 day', expires_at = now() + interval '1 day' WHERE slot_id = 'STREET_9'", [holder]);
    const sell = await a.r('sell_coins_to_advertiser', { p_key: KEY, p_actor_id: u, p_nickname: 'x', p_slot_id: 'STREET_9', p_amount: 50 });
    assert.deepEqual(sell, { ok: false, error: '팔 코인이 부족해요.' }); assert.equal(await a.coins(holder), 440);
    // Guests, tribe pools and accounts with a login are untouched by the check.
    const live = await a.login('live@example.com'); assert.equal((await a.r('profile_read', { p_key: KEY, p_actor_id: live })).ok, true); assert.equal(await a.coins(live), 0); // an account row starts at 0
    assert.equal((await a.r('profile_read', { p_key: KEY, p_actor_id: gid() })).ok, true);
  });

  it('part 2 (a comment, run on its own): confirms the old e-mail and id sign-ups only, and a second run changes nothing', async () => {
    const text = read(MIG), at = text.indexOf('-- WITH done AS (');
    const part2 = text.slice(at).split('\n').filter((l) => l.startsWith('-- ')).map((l) => l.slice(3)).join('\n');
    assert.match(part2, /^WITH done AS \(\n  UPDATE auth\.users SET email_confirmed_at = now\(\)/);
    const left = async () => (await db.query('SELECT email FROM auth.users WHERE email_confirmed_at IS NULL ORDER BY email NULLS FIRST')).rows.map((x) => x.email);
    assert.deepEqual(await left(), [null, 'google@example.com', 'old.mail@example.com', 'old.signup@id.wishboard.dev']);
    assert.equal((await db.exec(part2)).at(-1).rows[0].confirmed, 2);
    assert.deepEqual(await left(), [null, 'google@example.com']); // the anonymous sign-in and the Google login stay as they were
    assert.equal((await db.exec(part2)).at(-1).rows[0].confirmed, 0);
    assert.match((await status(db))[0].note, /메일 확인이 안 끝난 옛 가입 0개/);
  });
});

describe('coins migration: a production function that is not as expected stops part 1 whole', { skip: SKIP, concurrency: false }, () => {
  it('sell_coins_to_advertiser without the expected line: nothing changes, and the result says why', async () => {
    const db = await make(OLD), a = api(db);
    try {
      await db.exec(`DO $x$ DECLARE d text; BEGIN d := pg_get_functiondef('public.sell_coins_to_advertiser(text,text,text,text,integer)'::regprocedure);
        EXECUTE replace(d, 'IF v_seller.coins < p_amount THEN', 'IF v_seller.coins <= p_amount - 1 THEN'); END $x$;`);
      const rows = await status(db);
      assert.equal(rows[0].applied, false); assert.match(rows[0].note, /^안 바뀜: 중단: 운영 DB의 sell_coins_to_advertiser에서 바꿀 줄을 0번 찾았습니다/);
      assert.equal((await a.one("SELECT to_regclass('public.gone_logins') IS NULL AS no")).no, true); // the tables went back too
      assert.equal((await a.one("SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('wallets_need_login', 'wallets_gone_mark')")).n, 0);
      const u = await a.login('x@example.com'), m = await a.merge(u, await a.guest()); assert.equal('guard' in m, false); assert.equal(m.moved, 140); // the old merge stands
    } finally { await db.close(); }
  });
  it('a wallet-making function without its wallet line (here touch_attend): nothing changes, and the result names it', async () => {
    const db = await make(OLD), a = api(db);
    try {
      await db.exec(`DO $x$ DECLARE d text; BEGIN d := pg_get_functiondef('public.touch_attend(text,text)'::regprocedure);
        EXECUTE replace(d, 'INSERT INTO public.wallets (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;', 'INSERT INTO public.wallets (actor_id) VALUES (p_actor_id) ON CONFLICT DO NOTHING;'); END $x$;`);
      const rows = await status(db);
      assert.equal(rows[0].applied, false); assert.match(rows[0].note, /^안 바뀜: 중단: 운영 DB의 touch_attend에서 지갑을 만드는 줄을 0번 찾았습니다/);
      const pr = (await a.one("SELECT pg_get_functiondef('public.profile_read(text,text)'::regprocedure) AS d")).d;
      assert.equal(pr.includes("'error', 'login'"), false); // the ones patched before it went back too
      assert.equal((await a.one("SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('wallets_need_login', 'wallets_gone_mark')")).n, 0);
    } finally { await db.close(); }
  });
});

describe('the coins migration file', () => {
  const mig = read(MIG), schema = read('schema.sql');
  const fn = (sql, name) => { const at = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.' + name + '('); return at < 0 ? null : sql.slice(at, sql.indexOf('\n$$;', at) + 4); };
  it('restates each function exactly as schema.sql has it, and says how to run it, what it changes and what is left for the owner', () => {
    for (const name of ['gone_hash', 'wallets_gone_mark', 'wallets_need_login', 'merge_guest_account']) { assert.ok(fn(mig, name), name); assert.equal(fn(mig, name), fn(schema, name), name); }
    assert.deepEqual([...mig.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]), ['gone_hash', 'wallets_gone_mark', 'wallets_need_login', 'merge_guest_account']);
    assert.ok(schema.includes('IF NOT FOUND OR v_seller.coins < p_amount THEN'));
    for (const said of ['postgres', '몇 번을 실행해도', 'kts_coins', 'destructive operation', 'GONE_SALT', 'GUEST_KEY', '2부', 'rollback']) assert.ok(mig.includes(said), said);
    assert.equal(/eyJ|sb_secret|service_role key/i.test(mig), false); // no key of any kind
    // Part 2 is only comments: running the whole file never confirms anybody.
    const live = mig.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    assert.doesNotMatch(live, /UPDATE auth\.users/);
    assert.ok(mig.trimEnd().endsWith('-- SELECT count(*) AS confirmed FROM done;'));
  });
});
