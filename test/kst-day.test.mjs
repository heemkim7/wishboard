// One KST calendar-day rule and one KST ISO-week rule. wish.js wishDay is the day, league.js leagueWeek the week; the Worker,
// ftue.js, adreport.js, ui.js and admin.html use those instead of their own copies. adsale.js keeps its one-line kstDay so the
// /ads page does not load wish.js and league.js for it; this checks the two agree.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wishDay } from '../wish.js';
import { leagueWeek } from '../league.js';
import { kstDay as ftueDay } from '../ftue.js';
import { kstDay as adDay } from '../adsale.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// The Worker's copies as they were before they were folded into wish.js and league.js.
const oldKstDay = (t = Date.now()) => new Date(t + 9 * 36e5).toISOString().slice(0, 10);
const oldIsoWeek = (t = Date.now()) => { const d = new Date(t + 9 * 36e5), w = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), dn = (w.getUTCDay() + 6) % 7; w.setUTCDate(w.getUTCDate() - dn + 3); const y = w.getUTCFullYear(), f = new Date(Date.UTC(y, 0, 4)); return y + 'W' + String(1 + Math.round(((w - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0'); };

// Every hour of 2024..2028 (leap years, ISO years with 53 weeks, year ends on every weekday), plus the KST midnight edges.
const times = [];
for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2029, 0, 8); t += 36e5) times.push(t);
for (const d of [Date.UTC(2026, 10, 19), Date.UTC(2026, 11, 31), Date.UTC(2027, 0, 3), Date.UTC(2028, 1, 28)]) for (const e of [-1, 0, 1]) times.push(d + 15 * 36e5 + e);

describe('KST day and week helpers', () => {
  it('ftue.js kstDay is wish.js wishDay', () => assert.equal(ftueDay, wishDay));
  it('every KST-day helper gives the same day the Worker always gave', () => {
    for (const t of times) { const want = oldKstDay(t); assert.equal(wishDay(t), want, t); assert.equal(adDay(t), want, t); }
    // the day turns at 00:00 KST (15:00 UTC)
    assert.equal(wishDay(Date.UTC(2026, 10, 19, 15, 0, 0)), '2026-11-20');
    assert.equal(wishDay(Date.UTC(2026, 10, 19, 14, 59, 59, 999)), '2026-11-19');
    // no argument: now
    const before = oldKstDay(), got = wishDay(), after = oldKstDay();
    assert.ok(got === before || got === after);
  });
  it('league.js leagueWeek is the Worker\'s old isoWeek', () => {
    for (const t of times) assert.equal(leagueWeek(t), oldIsoWeek(t), t);
    assert.equal(leagueWeek(Date.UTC(2026, 11, 31, 15)), '2026W53'); // Fri 1 Jan 2027 KST is still in ISO week 2026-W53
    assert.equal(leagueWeek(Date.UTC(2027, 0, 3, 15)), '2027W01'); // Mon 4 Jan 2027 00:00 KST
  });
  it('no module keeps its own copy of the day or week rule', () => {
    const w = read('worker.js');
    assert.match(w, /wishDay as kstDay \} from '\.\/wish\.js';/);
    assert.match(w, /leagueWeek as isoWeek \} from '\.\/league\.js';/);
    assert.equal(/const (kstDay|isoWeek) =/.test(w), false);
    assert.match(read('ftue.js'), /export \{ wishDay as kstDay \} from '\.\/wish\.js';/);
    assert.match(read('adreport.js'), /import \{ wishDay as dayOf \} from '\.\/wish\.js';/);
    assert.match(read('admin.html'), /import \{ kstDay \} from '\.\/adsale\.js';/);
    const day = /\+ 9 \* 36e5\)\.toISOString\(\)\.slice\(0, 10\)/;
    for (const f of ['worker.js', 'ftue.js', 'adreport.js', 'ui.js', 'main.js', 'admin.html']) assert.equal(day.test(read(f)), false, f);
  });
});
