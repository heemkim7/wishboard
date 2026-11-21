/* K-Times Square service worker.
   Caches GET /assets/* only, under a revision taken from this script's ?v= query.
   HTML, JS, CSS, vendor/three, and /rt/* stay on the network. No character-sprite manifest. */
const REV = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'kts-assets-' + REV;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('kts-assets-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Payload { title?, body, url? } (older pushes carry only body; a non-JSON payload is shown as its text). url is same-origin only, default '/'.
function sameOriginPath(u) {
  try { const x = new URL(String(u || '/'), self.location.origin); return x.origin === self.location.origin ? x.pathname + x.search + x.hash : '/'; } catch { return '/'; }
}
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { try { d = { body: event.data ? event.data.text() : '' }; } catch { d = {}; } }
  if (!d || typeof d !== 'object') d = { body: String(d ?? '') };
  event.waitUntil(self.registration.showNotification(String(d.title || '') || '모두의 전광판', { body: String(d.body || ''), data: { url: sameOriginPath(d.url) } }));
});

// Click: an open game tab (path / or /index.html, never admin.html or a share page) is told where to go ({ t: 'push', url },
// main.js moves there in place) and focused; it is never navigated, which would reboot the game. No game tab: open a new one.
// Once a tab has the message it is the one that moves: if focusing it then fails, no second window is opened.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sameOriginPath(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      let same = false; try { const x = new URL(c.url); same = x.origin === self.location.origin && (x.pathname === '/' || x.pathname === '/index.html'); } catch { same = false; }
      if (!same) continue;
      try { c.postMessage({ t: 'push', url }); } catch { continue; } // this tab cannot be reached: the next one, or a new window
      try { return await c.focus(); } catch { return undefined; } // told but not focused: it still moves, in the background
    }
    return self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/assets/')) return;
  event.respondWith(fromAssetCache(req));
});

async function fromAssetCache(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}
