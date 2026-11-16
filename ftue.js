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

export function startFtue(ctx) {
  const { ui, world, balance } = ctx;
  ui.setNextLine?.('붕어빵 포차로 가 보세요');
  world.setWaypoint?.(balance ? { x: 21, z: 118 } : { x: 21, z: 118 });
  return { onBakePay() { world.setWaypoint?.(null); ui.setNextLine?.('메인거리 무료 칸에 이름을 걸어 보세요'); } };
}
