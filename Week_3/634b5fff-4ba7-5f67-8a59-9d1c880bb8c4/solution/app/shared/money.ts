/** Money is integer øre. Rounding half up is written here once and used by every split, refund and fee. */

const roundHalfUp = (numerator: number, denominator: number): number =>
  Math.floor((2 * numerator + denominator) / (2 * denominator));

export interface SplitParts {
  netOre: number;
  vatOre: number;
  charityOre: number;
  makerOre: number;
}

const BASIS_POINTS = 10000;

const charityShare = (netOre: number, rateBasisPoints: number): number =>
  roundHalfUp(netOre * rateBasisPoints, BASIS_POINTS);

/** The net part of a gross amount at 25 % VAT: round(gross / 1.25). */
const netOfGross = (grossOre: number): number => roundHalfUp(grossOre * 4, 5);

export const splitSale = (netOre: number, vatOre: number, rateBasisPoints: number): SplitParts => {
  const charityOre = charityShare(netOre, rateBasisPoints);
  return { netOre, vatOre, charityOre, makerOre: netOre - charityOre };
};

export const gatewayFee = (method: "card" | "bank", totalOre: number): number =>
  method === "card" ? roundHalfUp(totalOre * 125, BASIS_POINTS) + 100 : 400;

const GROUP = /\B(?=(\d{3})+(?!\d))/g;

/** Display edge only: 158400 -> "1,584.00"; negatives keep their minus in front. */
const formatKroner = (ore: number): string => {
  const sign = ore < 0 ? "-" : "";
  const absolute = Math.abs(ore);
  const whole = String(Math.floor(absolute / 100)).replace(GROUP, ",");
  return `${sign}${whole}.${String(absolute % 100).padStart(2, "0")}`;
};

export const formatDkk = (ore: number): string => (ore < 0 ? `-DKK ${formatKroner(-ore)}` : `DKK ${formatKroner(ore)}`);

/** "333.33" or "333,33" or "333" -> øre, or null when it is not an amount. */
export const parseKroner = (text: string): number | null => {
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
};

/** Kill Bill speaks decimal kroner: 81926 -> "819.26". */
export const toDecimalKroner = (ore: number): string => `${ore < 0 ? "-" : ""}${Math.floor(Math.abs(ore) / 100)}.${String(Math.abs(ore) % 100).padStart(2, "0")}`;

/** A decimal kroner number or string as signed øre, or null when it is not a plain decimal. */
export const fromDecimalKroner = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2})0*)?$/.exec(String(value));
  if (!match) return null;
  const ore = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -ore : ore;
};

export interface Remainders extends SplitParts {
  grossOre: number;
}

/**
 * The parts of a refund of `amountOre` drawn on the box, at the order's locked rate. No part exceeds what remains of it
 * (the shaved øre moves to its pair), and the refund that empties the box takes every remainder exactly.
 */
export const splitRefund = (amountOre: number, remaining: Remainders, rateBasisPoints: number): SplitParts => {
  if (amountOre === remaining.grossOre) {
    return { netOre: remaining.netOre, vatOre: remaining.vatOre, charityOre: remaining.charityOre, makerOre: remaining.makerOre };
  }
  let netOre = Math.min(netOfGross(amountOre), remaining.netOre);
  let vatOre = amountOre - netOre;
  if (vatOre > remaining.vatOre) {
    vatOre = remaining.vatOre;
    netOre = amountOre - vatOre;
  }
  let charityOre = Math.min(charityShare(netOre, rateBasisPoints), remaining.charityOre);
  let makerOre = netOre - charityOre;
  if (makerOre > remaining.makerOre) {
    makerOre = remaining.makerOre;
    charityOre = netOre - makerOre;
  }
  return { netOre, vatOre, charityOre, makerOre };
};
