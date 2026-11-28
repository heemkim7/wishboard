// Builds /og.jpg, the 1200 x 630 link-preview picture, from tools/og/og.html with a local headless Chrome or Edge.
//   node tools/build-og.mjs            -> writes og.jpg at the repo root
//   node tools/build-og.mjs --out x.jpg
//   node tools/build-og.mjs --icons    -> the app icons from tools/og/icon.html: icons/app-icon-192.png, -512.png, -maskable-512.png,
//                                         app-icon.png and app-icon.jpg (512). Raise ?v= on app-icon.jpg in the pages after a rebuild.
// The page is served from a throwaway local server rooted at the repo, so it can import giftart.js and read icons/street.jpg.
// Set CHROME to the browser's path if it is not found. After a rebuild, raise og.jpg?v= in index.html, gift.html and ads.html
// (link scrapers cache the picture by address).
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1200, H = 630, MAX_BYTES = 300 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

function findBrowser() {
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files', pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const tries = [process.env.CHROME,
    path.join(pf, 'Google/Chrome/Application/chrome.exe'), path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'), path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return tries.find((p) => p && fs.existsSync(p)) || null;
}

function serve() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    if (req.method !== 'GET' || !file.startsWith(ROOT + path.sep) || !MIME[path.extname(file)] || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)], 'cache-control': 'no-store' }).end(fs.readFileSync(file));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

// A minimal DevTools client: send(method, params, sessionId) -> result; once(event) -> params.
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const waiting = new Map(), events = new Map();
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { const { ok, no } = waiting.get(d.id); waiting.delete(d.id); d.error ? no(new Error(d.error.message)) : ok(d.result); }
    else if (d.method && events.has(d.method)) { events.get(d.method)(d.params); events.delete(d.method); }
  });
  return new Promise((ready, fail) => {
    ws.addEventListener('error', () => fail(new Error('DevTools socket failed')));
    ws.addEventListener('open', () => ready({
      send: (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waiting.set(id, { ok, no }); ws.send(JSON.stringify({ id, method, params, sessionId })); }),
      once: (event) => new Promise((ok) => events.set(event, ok)),
      close: () => ws.close(),
    }));
  });
}

// The app icons: [file, side, maskable, format].
const ICONS = [['icons/app-icon-192.png', 192, false, 'png'], ['icons/app-icon-512.png', 512, false, 'png'], ['icons/app-icon-maskable-512.png', 512, true, 'png'],
  ['icons/app-icon.png', 512, false, 'png'], ['icons/app-icon.jpg', 512, false, 'jpeg']];

async function main() {
  const icons = process.argv.includes('--icons');
  const i = process.argv.indexOf('--out');
  const out = path.resolve(ROOT, i > 0 ? process.argv[i + 1] : 'og.jpg');
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome or Edge found. Set CHROME to the browser path.');
  const srv = await serve(), port = srv.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kts-og-'));
  const child = spawn(exe, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${W},${H}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const wsUrl = await new Promise((ok, no) => {
      let buf = ''; const t = setTimeout(() => no(new Error('The browser did not open a DevTools port in 20 s')), 20000);
      child.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); ok(m[1]); } });
      child.on('exit', (code) => { clearTimeout(t); no(new Error('The browser exited early (code ' + code + ')')); });
    });
    const c = await cdp(wsUrl);
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    await c.send('Page.enable', {}, sessionId);
    if (icons) {
      for (const [file, side, mask, format] of ICONS) {
        await c.send('Emulation.setDeviceMetricsOverride', { width: side, height: side, deviceScaleFactor: 1, mobile: false }, sessionId);
        const done = c.once('Page.loadEventFired');
        await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/og/icon.html?size=${side}&mask=${mask ? 1 : 0}` }, sessionId);
        await done;
        const r = await c.send('Runtime.evaluate', { expression: 'window.iconReady', awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error('icon.html failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        const shot = await c.send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 92 } : {}), clip: { x: 0, y: 0, width: side, height: side, scale: 1 } }, sessionId);
        const bytes = Buffer.from(shot.data, 'base64');
        fs.writeFileSync(path.resolve(ROOT, file), bytes);
        console.log(`${file}: ${side}x${side}${mask ? ' maskable' : ''}, ${bytes.length} bytes, W in ${r.result.value}`);
      }
      c.close();
      return;
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/og/og.html` }, sessionId);
    await loaded;
    const ready = await c.send('Runtime.evaluate', { expression: 'window.ogReady', awaitPromise: true, returnByValue: true }, sessionId);
    if (ready.exceptionDetails) throw new Error('og.html failed: ' + (ready.exceptionDetails.exception?.description || ready.exceptionDetails.text));
    let jpeg = null, used = 0;
    for (const quality of [90, 86, 82, 76, 70]) {
      const shot = await c.send('Page.captureScreenshot', { format: 'jpeg', quality, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } }, sessionId);
      jpeg = Buffer.from(shot.data, 'base64'); used = quality;
      if (jpeg.length <= MAX_BYTES) break;
    }
    if (jpeg.length > MAX_BYTES) throw new Error(`Still ${jpeg.length} bytes at quality ${used}; the limit is ${MAX_BYTES}`);
    fs.writeFileSync(out, jpeg);
    console.log(`${path.relative(ROOT, out)}: ${W}x${H}, ${jpeg.length} bytes, quality ${used}, text in ${ready.result.value}`);
    c.close();
  } finally {
    child.kill(); srv.close();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold it; the temp folder is cleaned later */ } }, 500);
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
