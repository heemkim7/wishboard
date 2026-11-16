import { SLOT_IDS } from './balance.js';
import { SITE } from './plaza-account.js?v=20261116f';

export function cardUrl(slot, opts = {}) {
  if (!SLOT_IDS.includes(String(slot || ''))) return '';
  const u = new URL('rt/card/' + slot, SITE);
  if (opts.gift) u.searchParams.set('gift', '1');
  if (opts.ref && /^[a-z0-9]{8}$/.test(opts.ref)) u.searchParams.set('ref', opts.ref);
  return u.toString();
}

export async function copyCard(slot, opts) {
  const url = cardUrl(slot, opts || {});
  if (!url || typeof navigator === 'undefined' || !navigator.clipboard) return false;
  await navigator.clipboard.writeText(url);
  return true;
}

// A phone already in portrait stays as it is. A wide canvas is copied into a live 9:16 frame so the file is vertical.
function portraitCanvas(canvas) {
  const w = Number(canvas.width) || 0;
  const h = Number(canvas.height) || 0;
  if (!w || !h || w * 16 <= h * 9 || typeof document === 'undefined') return { node: canvas, stop() {} };
  const tw = Math.max(2, Math.round(h * 9 / 16));
  const node = document.createElement('canvas');
  node.width = tw;
  node.height = h;
  const g = node.getContext('2d');
  const sx = Math.max(0, Math.round((w - tw) / 2));
  const draw = () => { try { g.drawImage(canvas, sx, 0, tw, h, 0, 0, tw, h); } catch { /* keep the last frame */ } };
  draw();
  const timer = setInterval(draw, 33);
  return { node, stop() { clearInterval(timer); } };
}

export async function saveClip(canvas) {
  if (typeof MediaRecorder === 'undefined' || !canvas?.captureStream) return null;
  const view = portraitCanvas(canvas);
  let stream = null;
  try {
    stream = view.node.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '' });
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data?.size) chunks.push(ev.data); };
    const done = new Promise((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' })); });
    rec.start();
    await new Promise((r) => setTimeout(r, 5000));
    rec.stop();
    const blob = await done;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wishboard.webm';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return blob;
  } finally {
    view.stop();
    if (stream) for (const t of stream.getTracks()) t.stop();
  }
}
