// migrations/2026-11-25-rls-on.sql, run for real. On 2026-11-25 Supabase's Security Advisor reported six production tables with row
// level security off (tribes, tribe_members, tribe_pool, tribe_scores, seasons, ops_events) although schema.sql switches it on, and
// Supabase grants anon and authenticated every table privilege in public, so the browser's key could read and write them.
// This builds that shape, shows the hole as the browser's role, runs the file, and shows the hole closed while the SECURITY DEFINER
// functions the Worker calls with that same key still answer. Needs PGlite outside the repo (see test/db.test.mjs); skipped without it.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIG = 'migrations/2026-11-25-rls-on.sql';
const SIX = ['tribes', 'tribe_members', 'tribe_pool', 'tribe_scores', 'seasons', 'ops_events'];
async function loadPGlite() {
  for (const d of [process.env.PGLITE_DIR, join(tmpdir(), 'kts-pglite')].filter(Boolean)) {
    try { const req = createRequire(join(d, 'package.json')); return (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; } catch { }
  }
  try { return (await import('@electric-sql/pglite')).PGlite; } catch { return null; }
}
const PGlite = await loadPGlite();
const SKIP = PGlite ? false : 'PGlite not installed (see test/db.test.mjs)';
const KEY = 'pglite-rls-key';
const WEEK = "to_char(timezone('Asia/Seoul', now()), 'IYYY') || 'W' || to_char(timezone('Asia/Seoul', now()), 'IW')";

// schema.sql as it is, with the roles Supabase provides.
async function fresh() {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(read('schema.sql'));
  await db.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']);
  return db;
}
// Production on 2026-11-25: the six tables without row level security, Supabase's default grants on everything in public, a few rows.
async function production() {
  const db = await fresh();
  for (const t of SIX) await db.exec('ALTER TABLE public.' + t + ' DISABLE ROW LEVEL SECURITY');
  await db.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
    INSERT INTO public.wallets (actor_id, nickname) VALUES ('user:rls-a', '가람');
    INSERT INTO public.tribes (id, tag, name, created_by) VALUES ('aaaaaaaa', 'NEON', '네온', 'user:rls-a');
    INSERT INTO public.tribe_members (tribe_id, actor_id, role) VALUES ('aaaaaaaa', 'user:rls-a', 'owner');
    INSERT INTO public.tribe_pool (tribe_id, slot_id, actor_id, amount, week) VALUES ('aaaaaaaa', 'STREET_1', 'user:rls-a', 5, '2026W48');
    INSERT INTO public.tribe_scores (tribe_id, week, points) VALUES ('aaaaaaaa', ${WEEK}, 7);`);
  return db;
}
const count = async (db, t) => (await db.query('SELECT count(*)::int n FROM public.' + t)).rows[0].n;
const counts = async (db) => Object.fromEntries(await Promise.all(SIX.map(async (t) => [t, await count(db, t)])));
// Runs fn as the browser's role, then steps back to the owner whatever happened.
async function asRole(db, role, fn) { await db.exec('SET ROLE ' + role); try { return await fn(); } finally { await db.exec('RESET ROLE'); } }
const off = async (db) => (await db.query("SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p') AND NOT relrowsecurity ORDER BY 1")).rows.map((r) => r.relname);
// The file's last statement is the result row the SQL editor shows.
const run = async (db) => { const out = await db.exec(read(MIG)); return out[out.length - 1].rows[0]; };

describe('row level security on every public table', { skip: SKIP }, () => {
  it('schema.sql on an empty database leaves no public table without it', async () => {
    const db = await fresh();
    try { assert.deepEqual(await off(db), []); } finally { await db.close(); }
  });

  it("the file names exactly the six tables, and schema.sql switches each of them on", () => {
    const sql = read(MIG).replace(/^--.*$/gm, ''), schema = read('schema.sql');
    assert.deepEqual([...sql.matchAll(/ALTER TABLE IF EXISTS public\.(\w+) ENABLE ROW LEVEL SECURITY;/g)].map((m) => m[1]).sort(), [...SIX].sort());
    for (const t of SIX) assert.ok(schema.includes('ALTER TABLE public.' + t + ' ENABLE ROW LEVEL SECURITY;'), t);
    assert.ok(!/CREATE POLICY|DISABLE ROW LEVEL|DROP |DELETE |UPDATE |INSERT |GRANT |REVOKE /i.test(sql), 'nothing but the six switches and the result row');
  });

  it('production before the file: the browser role reads, inserts, updates and deletes in the six tables', async () => {
    const db = await production();
    try {
      assert.deepEqual(await off(db), [...SIX].sort());
      for (const role of ['anon', 'authenticated']) {
        await asRole(db, role, async () => {
          assert.deepEqual(await counts(db), { tribes: 1, tribe_members: 1, tribe_pool: 1, tribe_scores: 1, seasons: 1, ops_events: 0 }, role + ' reads');
          await db.query("INSERT INTO public.ops_events (id, starts_on, ends_on, theme, title, copy) VALUES ('x-" + role + "', '2026-01-01', '2036-01-01', 'none', 't', 'anyone can write this')");
          assert.equal((await db.query("UPDATE public.seasons SET title = 'changed'")).affectedRows, 1, role + ' updates');
          assert.equal((await db.query("DELETE FROM public.ops_events WHERE id = 'x-" + role + "'")).affectedRows, 1, role + ' deletes');
        });
      }
    } finally { await db.close(); }
  });

  it('after the file: applied, all six on, the rows untouched, and the browser role gets nothing in or out', async () => {
    const db = await production();
    try {
      const before = await counts(db);
      const row = await run(db);
      assert.equal(row.part, 'RLS 켜기'); assert.equal(row.applied, true); assert.match(row.note, /^적용됨\. 여섯 표 가운데 이 DB에 있는 6개의 RLS가 켜져 있습니다\. public에 RLS가 꺼진 표가 없습니다$/);
      assert.deepEqual(await off(db), []);
      assert.deepEqual(await counts(db), before, 'the owner still sees every row');
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1)", [SIX])).rows[0].n, 0, 'no policy was added: no public read');
      for (const role of ['anon', 'authenticated']) {
        await asRole(db, role, async () => {
          assert.deepEqual(await counts(db), { tribes: 0, tribe_members: 0, tribe_pool: 0, tribe_scores: 0, seasons: 0, ops_events: 0 }, role + ' reads nothing');
          await assert.rejects(db.query("INSERT INTO public.ops_events (id, starts_on, ends_on, theme, title, copy) VALUES ('y', '2026-01-01', '2036-01-01', 'none', 't', 'c')"), /row-level security/, role + ' insert');
          await assert.rejects(db.query("INSERT INTO public.tribes (id, tag, name, created_by) VALUES ('bbbbbbbb', 'EVIL', 'x', 'user:x')"), /row-level security/, role + ' insert');
          assert.equal((await db.query("UPDATE public.seasons SET title = 'changed'")).affectedRows, 0, role + ' update');
          assert.equal((await db.query('DELETE FROM public.tribe_members')).affectedRows, 0, role + ' delete');
        });
      }
      assert.deepEqual(await counts(db), before);
      assert.equal((await db.query("SELECT title FROM public.seasons WHERE id = 's1-2027'")).rows[0].title, '새해 소원');
    } finally { await db.close(); }
  });

  it('the functions the Worker calls with the browser key still read and write those tables', async () => {
    const db = await production();
    try {
      await run(db);
      await asRole(db, 'anon', async () => {
        const one = async (sql, args) => (await db.query(sql, args)).rows[0].r;
        // Writes ops_events, then plaza_live reads ops_events and tribes.
        assert.deepEqual(await one("SELECT public.upsert_ops_event($1, 'ev1', '2026-01-01', '2036-01-01', 'none', '행사', '문구') AS r", [KEY]), { ok: true, id: 'ev1' });
        assert.deepEqual((await one('SELECT public.plaza_live($1) AS r', [KEY])).ops, { id: 'ev1', theme: 'none', title: '행사', copy: '문구' });
        // Reads tribe_members, tribes and tribe_scores.
        const mine = await one("SELECT public.my_tribe($1, 'user:rls-a') AS r", [KEY]);
        assert.equal(mine.ok, true); assert.equal(mine.tribe_id, 'aaaaaaaa'); assert.equal(mine.points, 7);
        // The key is still the only way in.
        await assert.rejects(db.query("SELECT public.plaza_live('wrong')"), /Unauthorized worker key/);
      });
      assert.equal(await count(db, 'ops_events'), 1);
    } finally { await db.close(); }
  });

  it('a second run changes nothing, and a database without one of the tables is told which', async () => {
    const db = await production();
    try {
      const first = await run(db), second = await run(db);
      assert.deepEqual(second, first);
      await db.exec('DROP TABLE public.tribe_scores');
      const row = await run(db);
      assert.equal(row.applied, true); assert.match(row.note, /이 DB에 있는 5개의 RLS가 켜져 있습니다 \(없는 표: tribe_scores\)\. public에 RLS가 꺼진 표가 없습니다$/);
    } finally { await db.close(); }
  });

  it('a table the file does not cover is named in the note, and applied stays about the six', async () => {
    const db = await production();
    try {
      await db.exec('CREATE TABLE public.left_open (id int)');
      const row = await run(db);
      assert.equal(row.applied, true); assert.match(row.note, /이 파일이 다루지 않는 표 가운데 RLS가 꺼진 것: left_open$/);
    } finally { await db.close(); }
  });
});
