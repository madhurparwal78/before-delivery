// Money (brief: Business rules › Money): exact centimes on BigInt, half-up per line, the total to
// the nearest five centimes. Estimate and invoice totals are computed here and nowhere else.
import type { Line } from "../shared/api.js";
import type { LineKind } from "../shared/domain.js";
import { formatScaled, roundHalfUp } from "../shared/decimal.js";

export const VAT_RATE_TEXT = "8.1";
export const LABOUR_RATE_CENTIMES = 14500n;
const VAT_PER_MILLE = 81n; // 8.1 % = 81 / 1000

export interface PricedLine {
  id: string;
  kind: LineKind;
  description: string;
  quantityHundredths: bigint;
  unitPriceCentimes: bigint;
}

interface Totals {
  lines: Line[];
  net: bigint;
  vat: bigint;
  rounding: bigint;
  total: bigint;
}

export function chf(centimes: bigint): string {
  return formatScaled(centimes, 2);
}

/** Line nets and VAT rounded half up to the centime, then the total to the nearest 0.05. */
export function totals(lines: PricedLine[]): Totals {
  let net = 0n;
  let vat = 0n;
  const out: Line[] = lines.map((line) => {
    const lineNet = roundHalfUp(line.quantityHundredths * line.unitPriceCentimes, 100n);
    const lineVat = roundHalfUp(lineNet * VAT_PER_MILLE, 1000n);
    net += lineNet;
    vat += lineVat;
    return {
      id: line.id,
      kind: line.kind,
      description: line.description,
      quantity: formatScaled(line.quantityHundredths, 2),
      unit_price: chf(line.unitPriceCentimes),
      net: chf(lineNet),
      vat: chf(lineVat),
    };
  });
  const unrounded = net + vat;
  const total = roundHalfUp(unrounded, 5n) * 5n;
  return { lines: out, net, vat, rounding: total - unrounded, total };
}
