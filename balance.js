// Coin amounts and trigger sizes. Map coordinates stay in ts3d/layout.js.
export const BALANCE = {
  cooldownMs: 2200,
  stallR: 7,
  stageR: 4.2,
  stageFrontR: 6,
  taxiParkedR: 7,
  taxiStandR: 6,
  taxiStandCabR: 16,
  starR: 2,
  cheerNear: 8,
  cheerGroup: 8,
  cheerSolo: 2,
  floors: { S: 3000, B: 500, C: 100 },
  starterSlots: ['PLOT_18', 'PLOT_19', 'PLOT_20'],
  starterBid: 30,
  bakeGold: 15,
  bakeGood: 5,
  starCoin: 8,
  flushAskMs: 8000,
  grantKeepMs: 180000,
};

export function floorOf(slotId) {
  if (BALANCE.starterSlots.includes(slotId)) return BALANCE.starterBid;
  if (slotId === 'MAIN_S') return BALANCE.floors.S;
  if (/^SUB_B[1-4]$/.test(slotId || '')) return BALANCE.floors.B;
  return BALANCE.floors.C;
}
