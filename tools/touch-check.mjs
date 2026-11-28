// A phone's tap, for real: opens the plaza in a local headless Chrome as a 375 x 812 touch phone (DPR 3, touch events, a
// phone user agent), enters as a guest and taps with CDP Input.dispatchTouchEvent (touchStart / touchEnd), so the browser
// makes the pointer, compatibility mouse and click events a phone makes. It checks that a sheet opened by a tap stays open
// (2026-11-28: the round 걸기 button opened the board sheet on pointerdown and the click after touchend closed it at once;
// overlay.js createTapGuard).
//   node tools/touch-check.mjs [http://127.0.0.1:8791/]      exit 0 = every check held, 1 = one failed
// Point it at a local `wrangler dev` (it opens sheets only, never presses 걸기 / 무료로 걸기; entering makes one guest).
// Set CHROME to the browser's path if it is not found.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8791/';
const W = 375, H = 812;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function findBrowser() {
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files', pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  return [process.env.CHROME, path.join(pf, 'Google/Chrome/Application/chrome.exe'), path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find((p) => p && fs.existsSync(p)) || null;
}
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const waiting = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { const { ok, no } = waiting.get(d.id); waiting.delete(d.id); d.error ? no(new Error(d.error.message)) : ok(d.result); } });
  return new Promise((ready, fail) => {
    ws.addEventListener('error', () => fail(new Error('DevTools socket failed')));
    ws.addEventListener('open', () => ready({ send: (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waiting.set(id, { ok, no }); ws.send(JSON.stringify({ id, method, params, sessionId })); }), close: () => ws.close() }));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome or Edge found. Set CHROME to the browser path.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kts-touch-'));
  const child = spawn(exe, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let failed = 0;
  try {
    const wsUrl = await new Promise((ok, no) => {
      let buf = ''; const t = setTimeout(() => no(new Error('The browser did not open a DevTools port in 20 s')), 20000);
      child.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); ok(m[1]); } });
    });
    const c = await cdp(wsUrl);
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => c.send(m, p, s);
    const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.value; };
    const until = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await wait(250); } return false; };
    const tap = async (x, y) => {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
      await wait(50);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const tapSel = async (sel) => {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.closest('[hidden]')) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; })()`);
      if (!r) return false;
      await tap(r.x, r.y);
      return true;
    };
    const sheets = () => ev(`[...document.querySelectorAll('.modal h2')].map((e) => e.textContent.trim())`);
    const closeAll = () => ev(`(() => { for (let i = 0; i < 6; i++) { const x = [...document.querySelectorAll('.modal .x')].pop(); if (!x) break; x.click(); } })()`);
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'Linux armv8l' });
    await send('Page.navigate', { url: BASE });
    if (!await until(`!!document.querySelector('#bootEnter .enter-go')`, 90000)) throw new Error('The boot card never offered the plaza');
    for (let i = 0; i < 5 && !await until(`document.getElementById('boot')?.classList.contains('gone') ?? true`, 500); i++) {
      await wait(1200);
      await tapSel('#bootEnter .enter-go');
      await until(`document.getElementById('boot')?.classList.contains('gone') ?? true`, 5000);
    }
    await wait(6000);
    await closeAll();
    const check = async (name, sel) => {
      await closeAll(); await wait(400);
      if (!await until(`!!document.querySelector(${JSON.stringify(sel)}) && !document.querySelector(${JSON.stringify(sel)}).closest('[hidden]')`, 30000)) {
        const why = await ev(`JSON.stringify({ sheets: [...document.querySelectorAll('.modal h2')].map((e) => e.textContent), boot: !!document.getElementById('boot'), prompt: document.querySelector('#ui .prompt')?.className || '' })`);
        console.log(`skip  ${name}: ${sel} is not on screen ${why}`); return;
      }
      await tapSel(sel);
      await wait(1200); // the compatibility click comes right after touchend; a ghost would have closed the sheet by now
      const open = await sheets();
      const ok = open.length > 0;
      if (!ok) failed += 1;
      console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}: ${ok ? 'open after 1.2 s · ' + open.join(' / ') : 'no sheet open 1.2 s after the tap'}`);
    };
    await check('round touch button 걸기 (opens on pointerdown)', '#ui .act.big');
    await check('HUD 전광판 걸기 (opens on click)', '#ui .tool-board');
    await check('오늘의 소원', '#ui .tool-wish');
    c.close();
  } finally {
    try { child.kill(); } catch { /* gone */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold it */ }
  }
  return failed;
}

main().then((n) => { process.exitCode = n ? 1 : 0; }, (e) => { console.error(e.message || e); process.exitCode = 1; });
