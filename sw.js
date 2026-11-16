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

self.addEventListener('push', (event) => {
  let body = '';
  try { body = event.data ? (event.data.json().body || '') : ''; } catch { try { body = event.data ? event.data.text() : ''; } catch { body = ''; } }
  event.waitUntil(self.registration.showNotification('모두의 전광판', { body: String(body || '') }));
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
