import { applyBps, divideRound } from '../shared/money.js';

/** Edition and pricing figures, decided in one place. */
export const EDITION_SIZE = 240;
export const BOX_GROSS_ORE = 149_500;
export const BOX_VAT_RATE = { num: 25, den: 100 };
export const BOX_NET_ORE = 119_600; // gross minus 25% VAT
export const COURIER_ORE = 8_900;
export const ORDER_TOTAL_ORE = BOX_GROSS_ORE + COURIER_ORE;
export const CHARITY_NAME = 'Varmestuen Nord';
export const SEED_RATE_BPS = 3150;
export const EDITION_CLOSE_INSTANT = Date.parse('2027-02-01T00:00:00+01:00');

/** Plates cycle across Stove, Goose, Tree, Star, Grandmother. */
export const PLATES = ['stove', 'goose', 'tree', 'star', 'grandmother'] as const;
export type Plate = (typeof PLATES)[number];

export function plateFor(number: number): Plate {
  return PLATES[(number - 1) % 5];
}

/** Split: charity = round(net * rate), maker = net - charity. */
export function splitBox(netOre: number, rateBps: number): { charityOre: number; makerOre: number } {
  const charityOre = applyBps(netOre, rateBps);
  return { charityOre, makerOre: netOre - charityOre };
}

/** The seed split shown on the box page before any rate change. */
export function seedSplit() {
  return splitBox(BOX_NET_ORE, SEED_RATE_BPS);
}

/** Gateway fee due on capture/settle, never returned on refund. */
export function gatewayFeeOre(method: 'card' | 'bank'): number {
  if (method === 'card') return divideRound(ORDER_TOTAL_ORE * 125, 10_000) + 100;
  return 400;
}

/** Partial refund of R drawn on the box, capped at remainders. */
export function refundParts(
  amountOre: number,
  rateBps: number,
  remaining: { netOre: number; vatOre: number; charityOre: number; makerOre: number },
): { netOre: number; vatOre: number; charityOre: number; makerOre: number } {
  // Drawn on the box's gross remainder, not the order total (courier never refunds).
  let netOre = divideRound(amountOre * 100, 125);
  let vatOre = amountOre - netOre;
  if (netOre > remaining.netOre) {
    netOre = remaining.netOre;
    vatOre = Math.min(amountOre - netOre, remaining.vatOre);
  } else if (vatOre > remaining.vatOre) {
    vatOre = remaining.vatOre;
    netOre = Math.min(amountOre - vatOre, remaining.netOre);
  }
  let charityOre = applyBps(netOre, rateBps);
  let makerOre = netOre - charityOre;
  if (charityOre > remaining.charityOre) {
    charityOre = remaining.charityOre;
    makerOre = Math.min(netOre - charityOre, remaining.makerOre);
  } else if (makerOre > remaining.makerOre) {
    makerOre = remaining.makerOre;
    charityOre = Math.min(netOre - makerOre, remaining.charityOre);
  }
  return { netOre, vatOre, charityOre, makerOre };
}

/** The remainder each part may still refund. */
export function remainingParts(sale: { netOre: number; vatOre: number; charityOre: number; makerOre: number }, settledRefunds: { netOre: number; vatOre: number; charityOre: number; makerOre: number }[]) {
  let net = sale.netOre, vat = sale.vatOre, charity = sale.charityOre, maker = sale.makerOre;
  for (const r of settledRefunds) {
    net -= r.netOre; vat -= r.vatOre; charity -= r.charityOre; maker -= r.makerOre;
  }
  return { netOre: net, vatOre: vat, charityOre: charity, makerOre: maker };
}
