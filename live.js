export function nextBallUntil(now, open) {
  const kst = new Date(now + 9 * 3600000);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
  const hour = open ? 21 : 21;
  const minute = open ? 10 : 0;
  let stamp = Date.UTC(y, m, d, hour - 9, minute, 0);
  if (!open && stamp <= now) stamp = Date.UTC(y, m, d + 1, hour - 9, minute, 0);
  return stamp;
}

export function applyBall(msg) {
  if (!msg || msg.t !== 'BALL') return '';
  return msg.open ? '21:10까지 메인 타워가 열려 있어요' : '메인 타워는 밤 9시에 10분 열려요';
}

export function ballNotice(wasOpen, msg) {
  const open = !!msg?.open;
  if (open === !!wasOpen) return '';
  return applyBall(msg);
}

export function applyOps(ops) {
  if (!ops || !ops.copy) return '';
  return String(ops.copy).slice(0, 80);
}

// wait until the server session id arrives, then send that id. A later game must not reuse it.
// Buckets to settle. seen 0 means this room has never drawn, so only the bucket that just closed.
// ponytail: at most 12 buckets (1 hour). Older tickets need a reconnect into the next bucket.
export function drawSpan(seen, bucket) {
  const start = seen > 0 ? seen : bucket - 1;
  if (bucket <= start) return [];
  const from = Math.max(start, bucket - 12);
  const out = [];
  for (let b = from; b < bucket; b++) out.push(b);
  return out;
}

export function sessionEndPlan(id, failed, waited, limit) {
  if (!id && !failed && waited < limit) return 'wait';
  if (!id) return failed ? 'skip' : 'note';
  return 'send';
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('live.js')) {
  if (sessionEndPlan('', false, 1000, 4000) !== 'wait') throw new Error('wait');
  if (sessionEndPlan('', true, 5000, 4000) !== 'skip') throw new Error('skip');
  if (sessionEndPlan('', false, 5000, 4000) !== 'note') throw new Error('note');
  if (sessionEndPlan('s1', false, 5000, 4000) !== 'send') throw new Error('send');
  if (drawSpan(0, 100).join() !== '99') throw new Error('first');
  if (drawSpan(100, 100).length) throw new Error('same');
  if (drawSpan(100, 101).join() !== '100') throw new Error('next');
  if (drawSpan(90, 110).join() !== '98,99,100,101,102,103,104,105,106,107,108,109') throw new Error('cap');
}
