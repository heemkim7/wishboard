// 계절 소원 테마 (launch plan 하1): the date table (seasons.js), the ops calendar laid over it, the wish card painter and the Worker's theme list.
// Dates are KST days; the clock is never read here: every case passes the day (or a fixed millisecond) in.
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };

const S = await import('../seasons.js');
const { wishDay, wishFault, WISH } = await import('../wish.js');
const { paintWish } = await import('../ts3d/art.js');
const worker = (await import('../worker.js')).default;
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cps = (s) => Array.from(s).length;
const on = (day, admin) => S.seasonKey(day, admin);

describe('built-in table', () => {
  it('has the eight themes in priority order and the ops calendar adds none', () => {
    assert.deepEqual([...S.SEASON_KEYS], ['csat', 'seollal', 'chuseok', 'xmas', 'newyear', 'valentine', 'pepero', 'children']);
    assert.deepEqual([...S.OPS_THEME_KEYS], [...S.SEASON_KEYS, 'none']);
    for (const k of S.SEASON_KEYS) assert.ok(S.SEASONS[k], k);
    assert.deepEqual(Object.keys(S.SEASONS).sort(), [...S.SEASON_KEYS].sort());
  });

  it('solar days: Christmas 12/20 to 12/25, 새해 12/31 to 1/2, 발렌타인 2/14, 빼빼로데이 11/11, 어린이날 5/5', () => {
    for (const [day, key] of [['2026-12-19', ''], ['2026-12-20', 'xmas'], ['2026-12-25', 'xmas'], ['2026-12-26', ''], ['2026-12-30', ''], ['2026-12-31', 'newyear'],
      ['2027-01-01', 'newyear'], ['2027-01-02', 'newyear'], ['2027-01-03', ''], ['2027-02-13', ''], ['2027-02-14', 'valentine'], ['2027-02-15', ''],
      ['2027-11-10', ''], ['2027-11-11', 'pepero'], ['2027-11-12', ''], ['2027-11-13', 'csat'], ['2027-05-04', ''], ['2027-05-05', 'children'], ['2027-05-06', '']]) assert.equal(on(day), key, day);
  });

  it('a window over New Year works in both directions and in every year, leap days included', () => {
    for (const y of [2026, 2027, 2028, 2031]) {
      assert.deepEqual(S.seasonWindow('newyear', y), [`${y}-12-31`, `${y + 1}-01-02`]);
      assert.equal(on(`${y}-12-31`), 'newyear'); assert.equal(on(`${y + 1}-01-01`), 'newyear'); assert.equal(on(`${y + 1}-01-02`), 'newyear'); assert.equal(on(`${y + 1}-01-03`), '');
    }
    assert.equal(S.addDays('2028-02-28', 1), '2028-02-29'); assert.equal(S.addDays('2027-02-28', 1), '2027-03-01'); assert.equal(S.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(S.addDays('2027-01-01', -1), '2026-12-31');
  });

  it('KST boundaries: 15:00 UTC is the next KST day, so a theme starts at 00:00 KST and ends at 24:00 KST', () => {
    const at = (iso) => on(wishDay(Date.parse(iso)));
    assert.equal(at('2026-12-19T14:59:59.999Z'), ''); // 23:59:59.999 KST on 12-19
    assert.equal(at('2026-12-19T15:00:00.000Z'), 'xmas'); // 00:00 KST on 12-20
    assert.equal(at('2026-12-25T14:59:59.999Z'), 'xmas'); // 23:59:59.999 KST on 12-25
    assert.equal(at('2026-12-25T15:00:00.000Z'), ''); // 00:00 KST on 12-26
    assert.equal(at('2026-12-30T15:00:00.000Z'), 'newyear'); // 00:00 KST on 12-31, still 12-30 in UTC
    assert.equal(at('2027-01-01T14:59:59.999Z'), 'newyear'); // 23:59 KST on 1-1, while UTC says 1-1 as well
    assert.equal(at('2027-01-02T15:00:00.000Z'), ''); // 00:00 KST on 1-3
    assert.equal(at('2026-05-04T15:00:00.000Z'), 'children'); // 00:00 KST on 5-5
  });

  it('lunar holidays come from the table: 설날 and 추석 from three days before to the day after, for 2026 to 2028 only', () => {
    assert.deepEqual(S.LUNAR.seollal, { 2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26' });
    assert.deepEqual(S.LUNAR.chuseok, { 2026: '2026-09-25', 2027: '2027-09-15', 2028: '2028-10-03' });
    for (const [key, table] of [['seollal', S.LUNAR.seollal], ['chuseok', S.LUNAR.chuseok]]) {
      for (const [year, at] of Object.entries(table)) {
        assert.deepEqual(S.seasonWindow(key, year), [S.addDays(at, -3), S.addDays(at, 1)]);
        assert.equal(on(S.addDays(at, -4)) === key, false, key + year + ' before');
        for (let d = -3; d <= 1; d++) assert.equal(on(S.addDays(at, d)), key, key + year + ' ' + d);
        assert.equal(on(S.addDays(at, 2)), '', key + year + ' after');
      }
    }
    assert.equal(S.seasonWindow('seollal', 2029), null); // outside the table: no such theme, nothing guessed
    assert.equal(S.seasonWindow('chuseok', 2025), null);
    assert.equal(on('2029-02-10'), ''); assert.equal(on('2025-10-06'), '');
    assert.equal(on('2028-01-23'), 'seollal'); // 2028 설날 is in January
  });

  it('수능: the Thursday of the 3rd week, from five days before to the day after; the same Thursday as the rule for other years', () => {
    assert.deepEqual(S.LUNAR.csat, { 2026: '2026-11-19', 2027: '2027-11-18', 2028: '2028-11-16' });
    for (const [y, d] of Object.entries(S.LUNAR.csat)) assert.equal(new Date(d + 'T00:00:00Z').getUTCDay(), 4, d + ' is a Thursday');
    assert.deepEqual(S.seasonWindow('csat', 2026), ['2026-11-14', '2026-11-20']);
    assert.equal(on('2026-11-11'), 'pepero'); assert.equal(on('2026-11-13'), ''); assert.equal(on('2026-11-14'), 'csat'); assert.equal(on('2026-11-19'), 'csat'); assert.equal(on('2026-11-20'), 'csat'); assert.equal(on('2026-11-21'), '');
    // The rule (the one Thursday from Nov 13 to Nov 19) gives the real days of 2021 to 2025 and any year after the table.
    for (const [y, d] of [[2021, '2021-11-18'], [2022, '2022-11-17'], [2023, '2023-11-16'], [2024, '2024-11-14'], [2025, '2025-11-13'], [2029, '2029-11-15'], [2030, '2030-11-14']]) assert.equal(S.csatDay(y), d, String(y));
    for (let y = 2026; y <= 2040; y++) { const d = new Date(S.csatDay(y) + 'T00:00:00Z'); assert.equal(d.getUTCDay(), 4); assert.ok(d.getUTCDate() >= 13 && d.getUTCDate() <= 19); }
    assert.equal(on('2025-11-13'), 'csat'); assert.equal(on('2025-11-11'), 'csat'); // 빼빼로데이 is 수능 D-2 in 2025: the earlier window wins
  });

  it('two windows on one day: the earlier key of the priority order wins', () => {
    // 2026: 설날 is Feb 17, its window (2/14 to 2/18) covers 발렌타인 (2/14).
    assert.equal(on('2026-02-14'), 'seollal'); assert.equal(on('2027-02-14'), 'valentine');
    // 2025 수능 run-up (11/8 to 11/14) covers 빼빼로데이; in 2026 and 2027 it starts days after it.
    assert.equal(on('2025-11-11'), 'csat'); assert.equal(on('2026-11-11'), 'pepero');
  });

  it('anything that is not a KST day has no theme', () => {
    for (const bad of ['', undefined, null, 'x', '2026-1-1', '20261225', 12, '2026-12-25T00:00:00Z']) assert.equal(on(bad), '', String(bad));
  });
});

describe('ops calendar over the table', () => {
  it('an admin theme wins over the built-in one, on a day with or without a built-in theme', () => {
    assert.equal(on('2026-12-21', 'newyear'), 'newyear'); // xmas by the table
    assert.equal(on('2026-06-10', 'chuseok'), 'chuseok'); // nothing by the table
    assert.equal(on('2026-06-10', 'pepero'), 'pepero');
    for (const k of S.SEASON_KEYS) assert.equal(on('2026-03-03', k), k);
  });
  it("'none' switches the built-in theme off for those days", () => {
    assert.equal(on('2026-12-21', 'none'), ''); assert.equal(S.seasonFor('2026-12-21', 'none'), null);
  });
  it('a missing or unknown admin theme leaves the table in charge', () => {
    for (const a of [undefined, null, '', 'bogus', 'XMAS', 'constructor', '__proto__', 5]) assert.equal(on('2026-12-21', a), 'xmas', String(a));
    for (const a of [undefined, '', 'bogus']) assert.equal(on('2026-06-10', a), '');
  });
  it('seasonFor hands back the key with the copy', () => {
    const s = S.seasonFor('2026-12-24');
    assert.equal(s.key, 'xmas'); assert.equal(s.emoji, '🎄'); assert.equal(s.chips.length, 3); assert.equal(S.seasonFor('2026-06-10'), null);
    assert.equal(S.seasonFor('2026-06-10', 'children').key, 'children');
  });
  it("?season= previews a theme's look: a key or 'none', nothing else", () => {
    assert.equal(S.seasonPreview('?season=xmas'), 'xmas'); assert.equal(S.seasonPreview('?a=1&season=none'), 'none');
    for (const bad of ['', '?season=', '?season=bogus', '?x=1', '?season=constructor', undefined, null]) assert.equal(S.seasonPreview(bad), undefined, String(bad));
  });
  it("the Worker and the ops calendar form take exactly the same themes ('none' too)", () => {
    const form = read('admin.html').match(/<select id="opsTheme">([\s\S]*?)<\/select>/)[1];
    assert.deepEqual([...form.matchAll(/value="([a-z]+)"/g)].map((m) => m[1]).sort(), [...S.OPS_THEME_KEYS].sort());
    const sql = (t) => [...t.matchAll(/'(csat|xmas|newyear|seollal|valentine|chuseok|pepero|children|none)'/g)].map((m) => m[1]);
    const fn = read('schema.sql').slice(read('schema.sql').indexOf('FUNCTION public.upsert_ops_event(')).match(/p_theme NOT IN \(([^)]*)\)/)[1];
    assert.deepEqual(sql(fn).sort(), [...S.OPS_THEME_KEYS].sort());
    assert.deepEqual(sql(read('migrations/2026-11-22-themes.sql').match(/p_theme NOT IN \(([^)]*)\)/)[1]).sort(), [...S.OPS_THEME_KEYS].sort());
  });
});

describe('the words', () => {
  it('every theme has a header, a boot line, a short card label and three chips the wish rules take as they are', () => {
    for (const k of S.SEASON_KEYS) {
      const s = S.SEASONS[k];
      assert.ok(s.header.length > 8 && s.header.length <= 60, k + ' header');
      assert.ok(s.boot.length > 8 && s.boot.length <= 60, k + ' boot');
      assert.ok(cps(s.chip) >= 2 && cps(s.chip) <= 6, k + ' chip');
      assert.ok(/^[^\x00-\x7f]/.test(s.emoji) && cps(s.emoji) <= 2, k + ' emoji');
      assert.equal(s.chips.length, 3, k);
      assert.equal(new Set(s.chips).size, 3, k);
      for (const c of s.chips) {
        assert.ok(cps(c) <= WISH.maxLen, `${k} chip "${c}" is longer than ${WISH.maxLen}`);
        assert.equal(wishFault(c), '', `${k} chip "${c}" would be refused: ${wishFault(c)}`);
      }
      assert.match(s.accent, /^#[0-9a-f]{6}$/); assert.match(s.accent2, /^#[0-9a-f]{6}$/);
    }
  });
});

// A canvas that records what the painter does (no pixels): fillText calls with the fill colour at that moment, and every colour set.
function recorder(W = 1024, H = 576) {
  const log = { text: [], fills: new Set(), strokes: new Set(), stops: [], rects: [] };
  const st = { fillStyle: '#000', strokeStyle: '#000' };
  const g = new Proxy({}, {
    get(_, k) {
      if (k === 'measureText') return (t) => ({ width: String(t).length * 14 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: (o, c) => log.stops.push(c) });
      if (k === 'fillText') return (t, x, y) => log.text.push({ t: String(t), x, y, fill: st.fillStyle });
      if (k === 'fillRect') return (x, y, w, h) => log.rects.push({ x, y, w, h, fill: st.fillStyle });
      if (k in st) return st[k];
      return () => {};
    },
    set(_, k, v) {
      if (k === 'fillStyle') { st.fillStyle = v; if (typeof v === 'string') log.fills.add(v); }
      if (k === 'strokeStyle') { st.strokeStyle = v; if (typeof v === 'string') log.strokes.add(v); }
      return true;
    },
  });
  return { canvas: { width: W, height: H, getContext: () => g }, log };
}
const hex = (c) => String(c).toLowerCase();

describe('wish card painter', () => {
  const wish = { id: 'abc', nick: '민지', txt: '올해는 꼭 합격', hearts: 3 };
  it('without a season: the amber chip "오늘의 소원", the amber strip, nothing else changed', () => {
    const { canvas, log } = recorder();
    paintWish(canvas, wish, {});
    assert.ok(log.text.some((x) => x.t === '오늘의 소원'));
    assert.ok(log.text.some((x) => x.t === '올해는 꼭 합격' && hex(x.fill) === '#ffffff'));
    const strip = log.text.find((x) => x.t === '하루 한 줄, 누구나 무료'); assert.equal(hex(strip.fill), '#ffb020');
    assert.equal(log.stops.length, 0); assert.ok(!log.text.some((x) => x.t === S.SEASONS.xmas.emoji));
  });
  it('with a season: the chip carries the emoji and the name, the strip and the top line take the accent, the wish stays white', () => {
    for (const k of S.SEASON_KEYS) {
      const s = S.SEASONS[k], { canvas, log } = recorder();
      paintWish(canvas, wish, { season: s });
      assert.ok(log.text.some((x) => x.t === `${s.emoji} ${s.chip} 소원`), k + ' chip');
      assert.ok(log.text.some((x) => x.t === s.emoji && x.x > 900), k + ' corner emoji at the right');
      assert.equal(hex(log.text.find((x) => x.t === '하루 한 줄, 누구나 무료').fill), s.accent, k + ' strip');
      assert.equal(hex(log.text.find((x) => x.t === '올해는 꼭 합격').fill), '#ffffff', k + ' wish text stays white');
      assert.deepEqual(log.stops.map(hex), [s.accent, s.accent2], k + ' gradient');
      assert.ok([...log.strokes].some((c) => hex(c).startsWith('rgba(')), k + ' hairline');
    }
  });
  it('the owner-light-out strip stays muted, a custom chip wins, a card without accent or emoji paints as without a season', () => {
    let r = recorder(); paintWish(r.canvas, wish, { season: S.SEASONS.xmas, dark: true });
    assert.notEqual(hex(r.log.text.find((x) => x.t === '하루 한 줄, 누구나 무료').fill), S.SEASONS.xmas.accent);
    r = recorder(); paintWish(r.canvas, wish, { season: S.SEASONS.xmas, chip: '어제의 소원왕' }); assert.ok(r.log.text.some((x) => x.t === '어제의 소원왕'));
    r = recorder(); paintWish(r.canvas, wish, { season: { chip: 'x' } }); assert.ok(r.log.text.some((x) => x.t === '오늘의 소원'));
  });
  it('small and wide canvases paint without throwing', () => {
    for (const [W, H] of [[256, 144], [512, 288], [2048, 576]]) { const r = recorder(W, H); paintWish(r.canvas, wish, { season: S.SEASONS.pepero, wide: W > 1024 }); }
  });
});

describe('the Worker takes the new themes', () => {
  async function save(theme, supa) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return new Response(JSON.stringify(supa), { status: 200, headers: { 'content-type': 'application/json' } }); };
    try {
      const env = { ADMIN_KEY: 'admin-test-key-123', FLUSH_KEY: 'flush-test-key', GUEST_KEY: 'g', ASSETS: { fetch: () => new Response('a') } };
      const res = await worker.fetch(new Request('https://x.test/rt/admin/ops', { method: 'POST', headers: { 'x-admin-key': 'admin-test-key-123', 'content-type': 'application/json' }, body: JSON.stringify({ id: 'e1', starts_on: '2026-09-22', ends_on: '2026-09-26', theme, title: '추석', copy: '보름달에 소원을' }) }), env, { waitUntil() {} });
      return { status: res.status, body: await res.json(), calls };
    } finally { globalThis.fetch = real; }
  }
  it('chuseok, pepero, children and none reach upsert_ops_event; an unknown word does not', async () => {
    for (const t of ['chuseok', 'pepero', 'children', 'none', 'xmas']) {
      const r = await save(t, { ok: true, id: 'e1' });
      assert.equal(r.status, 200, t); assert.equal(r.body.ok, true, t);
      const rpc = r.calls.find((c) => /upsert_ops_event/.test(c.url)); assert.equal(rpc.body.p_theme, t);
    }
    const bad = await save('halloween', { ok: true });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'theme'); assert.equal(bad.calls.length, 0);
  });
  it("before migrations/2026-11-22-themes.sql the function answers 'theme' for the new ones: a 400 with that code, nothing saved", async () => {
    const r = await save('chuseok', { ok: false, error: 'theme' });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'theme');
    assert.match(read('admin.html'), /error === 'theme' \?/); // the form tells the owner which file to run
  });
});
