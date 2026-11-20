let blockedText = () => false;
try {
  ({ blockedText } = await import('./plaza-account.js?v=20261116f'));
} catch {
  ({ blockedText } = await import('./plaza-account.js'));
}

export function lockCelebration(ms) {
  const n = Math.floor(Number(ms));
  return n === 5000 ? 5000 : 0;
}

export function claimWizard(slot) {
  const freeIds = ['STREET_8', 'STREET_9', 'STREET_10', 'STREET_11'];
  const state = { step: 1, slot: String(slot || ''), lines: ['', '', ''], emoji: '✨', theme: 'cyber_navy' };
  return {
    get step() { return state.step; },
    get slot() { return state.slot; },
    get free() { return freeIds.includes(state.slot); },
    get mode() { return this.free ? 'starter' : 'claim'; },
    choose(id) { state.slot = String(id || ''); state.step = 1; },
    linesOk(a, b, c) {
      const rows = [a, b, c].map((s) => String(s || ''));
      if (rows.some((s) => [...s].length > 16)) return false;
      if (rows.some((s) => blockedText(s))) return false;
      state.lines = rows;
      return true;
    },
    next() { if (state.step < 3) state.step += 1; return state.step; },
    payload() {
      return { slot_id: state.slot, bid: this.free ? 0 : undefined, mode: this.mode, line1: state.lines[0], line2: state.lines[1], line3: state.lines[2], emoji: state.emoji, bg_theme: state.theme };
    },
  };
}

export function ftueStillDue(flag, daily) {
  if (flag) return false;
  if (!daily || typeof daily !== 'object') return true;
  return !((daily.earn | 0) || (daily.bake | 0) || (daily.streak | 0) || (daily.play | 0));
}

export function startFtue(ctx) {
  const { ui, world, balance } = ctx;
  ui.setNextLine?.('붕어빵 포차로 가 보세요');
  world.setWaypoint?.(balance ? { x: 21, z: 118 } : { x: 21, z: 118 });
  let here = false;
  return {
    onArrive() {
      if (here) return;
      here = true;
      ui.setNextLine?.('여기서 E를 눌러 붕어빵을 구우세요');
      ui.startBake?.();
    },
    onBakePay() {
      const id = ['STREET_8', 'STREET_9', 'STREET_10', 'STREET_11'].find((slot) => !world.boardView?.(slot)?.holder_id);
      const card = id ? world.slotCard?.(id) : null;
      if (card && Number.isFinite(card.x) && Number.isFinite(card.z)) {
        world.setWaypoint?.({ x: card.x, z: card.z });
        ui.setNextLine?.('하늘색 기둥을 따라 무료 칸으로 가세요');
        return;
      }
      world.setWaypoint?.(null);
      ui.setNextLine?.('메인거리 무료 칸에 이름을 걸어 보세요');
    },
  };
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('ftue.js')) {
  if (ftueStillDue('', null) !== true) throw new Error('new');
  if (ftueStillDue('1', null) !== false) throw new Error('flag');
  if (ftueStillDue('', { earn: 2 }) !== false) throw new Error('earn');
  if (ftueStillDue('', { streak: 1 }) !== false) throw new Error('streak');
const calls = [];
startFtue({
  ui: { setNextLine: (t) => calls.push(t) },
  world: {
    setWaypoint: (p) => calls.push(p),
    boardView: (id) => (id === 'STREET_11' ? {} : { holder_id: 'x' }),
    slotCard: (id) => (id === 'STREET_11' ? { x: 3, z: 4 } : null),
  },
}).onBakePay();
if (!calls.some((c) => c && c.x === 3 && c.z === 4)) throw new Error('wp');
if (calls.at(-1) !== '하늘색 기둥을 따라 무료 칸으로 가세요') throw new Error('line');
}
