// QA only. Ten guests walk the QA plaza (chapelqa:square, the room a browser joins with ?qa=1) of a local worker.
// Players on chapel:square never see them and /rt/here never counts them.
//   node tools/plaza-bots.mjs                        walk and emote on http://localhost:8787
//   BOT_HOST=https://... node tools/plaza-bots.mjs    another worker (the production host also needs --allow-prod)
//   node tools/plaza-bots.mjs --trade                also earn 응원 포인트 by 관람 (no play pays any more) and claim street boards
//                                                    (no sends: points are not transferable, the send route answers 410 off)
// Wallets, board claims and the spend ranking live in one database for every namespace. So --trade only runs when the
// worker's database (/rt/config) is not the production Supabase project, and never on the production host.
// Stop: Ctrl+C. They leave after 40 minutes.

const PROD_LABEL = 'wish' + 'board.workers.dev';
const PROD_HOST = new RegExp('(^|\\.)' + PROD_LABEL.replace(/\./g, '\\.') + '$', 'i');
const prodUrl = () => 'https://studio.' + PROD_LABEL;
const PROD_DB = 'yxddhpacuyaffaoutxjn';
const isProd = (host) => { try { return PROD_HOST.test(new URL(host).hostname); } catch { return true; } };
async function tradeAllowed(host, asked) {
  if (!asked || isProd(host)) return false;
  try {
    const j = await fetch(host + '/rt/config').then((r) => r.json());
    return typeof j?.url === 'string' && j.url.startsWith('https://') && !j.url.includes(PROD_DB);
  } catch { return false; }
}
const HOST = String(process.env.BOT_HOST || 'http://localhost:8787').replace(/\/+$/, '');
const TOPIC = 'chapelqa:square';
let trade = false; // only tradeAllowed() turns this on, before the bots start
const N = 10;
const MINUTES = 40;
const SCALE = 20, ORIGIN = 1500;
const toU = (m) => Math.round(m * SCALE + ORIGIN);
const NAMES = Array.from({ length: N }, (_, i) => 'QA봇' + (i + 1)); // not 네온봇N: the Worker refuses that name (the seeded production wallets)
const COLORS = ['#ff3d9a', '#3fe6ff', '#ffcf5a', '#39f58a', '#b84dff', '#ff6a3d', '#4d7cff', '#f4f6ff', '#ffcf5a', '#39f58a'];
const SPOTS = [
  [-24, -132], [-10, -110], [-6, -80], [-12, -40],
  [16, 28], [14, 44], [18, 68], [9, 72], [21, 108],
  [8, 47], [27, 52], [-18, -70], [4, 90], [-28, -120],
];
function walker(i) {
  const s = SPOTS[i % SPOTS.length];
  return { x: s[0], z: s[1], tx: s[0], tz: s[1], yaw: 0, pause: 0, spot: i % SPOTS.length, speed: 2.1 + (i % 5) * 0.3 };
}
function stepWalk(w, dt, now) {
  if (now < w.pause) return { x: w.x, z: w.z, yaw: w.yaw, v: 0, anim: 'idle' };
  const dx = w.tx - w.x, dz = w.tz - w.z, L = Math.hypot(dx, dz);
  if (L < 1.4) {
    let n = (Math.random() * SPOTS.length) | 0;
    if (n === w.spot) n = (n + 3) % SPOTS.length;
    w.spot = n; w.tx = SPOTS[n][0]; w.tz = SPOTS[n][1];
    w.pause = now + 1200 + Math.random() * 5000;
    return { x: w.x, z: w.z, yaw: w.yaw, v: 0, anim: 'idle' };
  }
  const step = Math.min(L, w.speed * dt);
  w.x += dx / L * step; w.z += dz / L * step; w.yaw = Math.atan2(dx, dz);
  return { x: w.x, z: w.z, yaw: w.yaw, v: w.speed, anim: 'walk' };
}

async function guest() {
  const r = await fetch(HOST + '/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!r.ok) throw new Error('guest ' + r.status);
  const j = await r.json();
  if (!j?.token || !j.sub) throw new Error('guest shape');
  return j;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HOST.replace(/^http/, 'ws') + '/rt/ws?topic=' + encodeURIComponent(TOPIC), ['masil2', 'at.' + token]);
    const timer = setTimeout(() => { try { ws.close(); } catch { } reject(new Error('ws timeout')); }, 12000);
    ws.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'ok') { clearTimeout(timer); ws.onmessage = null; resolve(ws); }
      else if (m.t === 'wait') { clearTimeout(timer); try { ws.close(); } catch { } reject(new Error('full')); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws')); };
  });
}

async function claim(token, nick, slot, bid, color, steal) {
  if (!trade) throw new Error('trade off');
  const r = await fetch(HOST + '/rt/claim-billboard', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({
      topic: TOPIC, nickname: nick, slot_id: slot, bid,
      line1: nick, line2: steal ? '빼앗았다' : '샀다', line3: '#QA봇',
      emoji: steal ? '⚔️' : '💰', bg_theme: 'cyber_navy', text_color: color,
    }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok !== false, error: j.error || j.err || r.status };
}

async function coinsOf(token) {
  await fetch(HOST + '/rt/flush-wallet', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ topic: TOPIC }) });
  const r = await fetch(HOST + '/rt/wallet', { headers: { authorization: 'Bearer ' + token } });
  const j = await r.json().catch(() => ({}));
  return Number(j.coins) || 0;
}

const streetFloor = (n) => (n <= 30 ? 200 + Math.round((n - 1) * 200 / 29) : 150 + Math.round((n - 31) * 100 / 19)); // balance.js streetBid
const plotFloor = (n) => 100 + Math.round((n - 1) * 200 / 17);
function floorOf(slot) {
  const n = Number(String(slot).split('_')[1]);
  if (String(slot).startsWith('STREET_')) return streetFloor(n);
  if (String(slot).startsWith('PLOT_')) return plotFloor(n);
  return 0;
}
function pickDeal(rows, name, coins, now) {
  const offers = [];
  let mine = 0;
  for (const b of rows || []) {
    const floor = floorOf(b.slot_id);
    if (!floor) continue;
    const alive = b.holder_id && Date.parse(b.expires_at) > now;
    if (alive && b.holder_name === name) { mine++; continue; }
    if (alive && !String(b.holder_name || '').startsWith('QA봇')) continue;
    if (alive && Date.parse(b.protected_until) > now) continue;
    const bid = alive ? Math.max(floor, Number(b.current_bid) + 50) : floor;
    if (bid > coins) continue;
    offers.push({ slot: b.slot_id, bid, steal: !!alive });
  }
  offers.sort((a, b) => (b.steal - a.steal) || (a.bid - b.bid));
  return { mine, offer: offers[0] || null };
}

async function runBot(i) {
  const name = NAMES[i], color = COLORS[i];
  const g = await guest();
  const feet = walker(i);
  const until = Date.now() + MINUTES * 60 * 1000;
  while (Date.now() < until) {
    let ws;
    try { ws = await connect(g.token); }
    catch (e) { console.log(name, 'retry', e.message); await new Promise((r) => setTimeout(r, 2000)); continue; }
    let emoteAt = Date.now() + 20000 + i * 1500, mineAt = 0, busy = false;
    const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
    const pose = (dt, now) => {
      const p = stepWalk(feet, dt, now);
      const face = String(Math.round((p.yaw * 180 / Math.PI) / 15) * 15);
      const vx = Math.round(Math.sin(p.yaw) * p.v * SCALE), vy = Math.round(Math.cos(p.yaw) * p.v * SCALE);
      return { p, face, vx, vy };
    };
    const hello = pose(0, Date.now());
    send({ t: 'tr', m: { name, outfit: color, av: (i % 3) + 1, x: toU(hello.p.x), y: toU(hello.p.z), face: hello.face, anim: 'walk', fl: 0, vx: hello.vx, vy: hello.vy } });
    let last = Date.now();
    const move = setInterval(() => {
      const t = Date.now();
      const dt = Math.min(0.25, (t - last) / 1000);
      last = t;
      const now = pose(dt, t);
      send({ t: 'p', a: [toU(now.p.x), toU(now.p.z), now.face, now.p.anim, 0, now.vx, now.vy] });
      if (trade && t > mineAt) { send({ t: 'BONUS', kind: 'lounge', amount: 2, nick: name }); mineAt = t + 20100; } // 관람: PAY.lounge, 20 s apart
      if (t > emoteAt) { send({ t: 'E', e: 4 }); emoteAt = t + 45000; }
    }, 120);
    const ping = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 20000);
    const deals = setInterval(() => {
      if (!trade || busy || ws.readyState !== 1) return;
      busy = true;
      market(g.token, name, color).catch((e) => console.log(name, e.message)).finally(() => { busy = false; });
    }, 18000);
    setTimeout(() => { if (trade && ws.readyState === 1) market(g.token, name, color).catch(() => {}); }, 4000 + i * 1500);
    console.log(name, 'in');
    await new Promise((resolve) => { ws.onclose = () => resolve(); });
    clearInterval(move); clearInterval(ping); clearInterval(deals);
    if (Date.now() < until) await new Promise((r) => setTimeout(r, 1000));
  }
}

async function market(token, name, color) {
  if (!trade) return;
  const coins = await coinsOf(token);
  const world = await fetch(HOST + '/rt/world').then((r) => r.json()).catch(() => ({}));
  const rows = world.billboards || [];
  const deal = pickDeal(rows, name, coins, Date.now());
  if (deal.offer && (deal.offer.steal || deal.mine === 0)) {
    const c = await claim(token, name, deal.offer.slot, deal.offer.bid, color, deal.offer.steal);
    console.log(name, deal.offer.steal ? '강탈' : '매수', deal.offer.slot, deal.offer.bid, c.ok ? 'ok' : c.error, '보유', coins);
    return;
  }
  // No send to another bot's board: points are never sent (the send route answers 410 off).
  console.log(name, '벌는 중', coins);
}

if (process.argv.includes('--check')) {
  const now = Date.now();
  const rows = [
    { slot_id: 'STREET_1', holder_id: 'a', holder_name: 'QA봇2', current_bid: 200, expires_at: new Date(now + 9e6).toISOString(), protected_until: new Date(now - 1000).toISOString() },
    { slot_id: 'PLOT_1', holder_id: null, current_bid: 100 },
    { slot_id: 'MAIN_TOP', holder_id: 'h', holder_name: '힘킴', current_bid: 3000, expires_at: new Date(now + 9e6).toISOString(), protected_until: new Date(now - 1000).toISOString() },
  ];
  const d = pickDeal(rows, 'QA봇1', 300, now);
  if (!d.offer || d.offer.slot !== 'STREET_1' || d.offer.bid !== 250 || d.offer.steal !== true) throw new Error('deal');
  const w = walker(0);
  w.tx = SPOTS[4][0]; w.tz = SPOTS[4][1];
  const a = stepWalk(w, 1, 1);
  const b = stepWalk(w, 1, 2);
  if (a.anim !== 'walk' || Math.hypot(b.x - w.tx, b.z - w.tz) > Math.hypot(a.x - w.tx, a.z - w.tz)) throw new Error('walk');
  if (!TOPIC.startsWith('chapelqa:')) throw new Error('topic');
  if (!isProd(prodUrl()) || !isProd('not a url') || isProd('http://localhost:8787')) throw new Error('prod host');
  const realFetch = globalThis.fetch;
  const config = (url) => { globalThis.fetch = async () => ({ json: async () => ({ url }) }); };
  config('https://staging.supabase.co');
  if (!(await tradeAllowed('http://localhost:8787', true))) throw new Error('trade on a staging database');
  if (await tradeAllowed('http://localhost:8787', false)) throw new Error('trade without --trade');
  if (await tradeAllowed(prodUrl(), true)) throw new Error('trade on the production host');
  config(`https://${PROD_DB}.supabase.co`);
  if (await tradeAllowed('http://localhost:8787', true)) throw new Error('trade on the production database');
  globalThis.fetch = async () => { throw new Error('down'); };
  if (await tradeAllowed('http://localhost:8787', true)) throw new Error('trade without /rt/config');
  let sent = 0;
  globalThis.fetch = async () => { sent++; return { ok: true, json: async () => ({}) }; };
  await claim('t', 'QA봇1', 'STREET_1', 200, '#ffffff', false).catch(() => {});
  await market('t', 'QA봇1', '#ffffff');
  globalThis.fetch = realFetch;
  if (sent) throw new Error('a request went out with trade off');
  process.exit(0);
}

if (isProd(HOST) && !process.argv.includes('--allow-prod')) {
  console.error(`${HOST} is the production host. Start a local worker (npx wrangler dev --port 8787), or pass --allow-prod to walk its QA room without trading.`);
  process.exit(1);
}
trade = await tradeAllowed(HOST, process.argv.includes('--trade'));
if (process.argv.includes('--trade') && !trade) console.log('--trade ignored: this worker is the production host, writes to the production database, or did not answer /rt/config');
console.log(`${N} bots on ${HOST} ${TOPIC} · ${trade ? 'walk and trade' : 'walk only'}`);

const jobs = NAMES.map((_, i) => new Promise((r) => setTimeout(r, i * 400)).then(() => runBot(i)).catch((e) => console.log(NAMES[i], 'fail', e.message)));
await Promise.all(jobs);
console.log('finished');
