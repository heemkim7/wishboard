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
  return msg.open ? '21:10까지 메인 타워가 열려 있어요' : '다음 볼은 21:00이에요';
}

export function applyOps(ops) {
  if (!ops || !ops.copy) return '';
  return String(ops.copy).slice(0, 80);
}
