import { EVENT_NAMES } from './plaza-account.js?v=20261113z';

const MAJOR = new Set(EVENT_NAMES);

export function trackEvent(eventName, params) {
  const name = String(eventName || '');
  const extra = params && typeof params === 'object' ? params : {};
  try {
    if (typeof window.gtag === 'function') window.gtag('event', name, extra);
    if (typeof window.clarity === 'function') window.clarity('event', name);
  } catch { /* analytics must not break play */ }
  if (!MAJOR.has(name)) return;
  try {
    fetch('/rt/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* offline */ }
}
