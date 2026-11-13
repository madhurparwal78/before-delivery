/** `<size>` in binary units and `<money>` in integer cents. */

import { fixed, formatScaled, scaleRoundHalfAway } from "./decimal.js";

const KIB = 1024;
const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

export function formatSize(bytes: number): string {
  if (bytes >= GIB) {
    return `${fixed(bytes, 1n, BigInt(GIB), 1)} GiB`;
  }
  if (bytes >= MIB) {
    return `${fixed(bytes, 1n, BigInt(MIB), 1)} MiB`;
  }
  if (bytes >= KIB) {
    return `${fixed(bytes, 1n, BigInt(KIB), 1)} KiB`;
  }
  return `${bytes} B`;
}

/** `<money>`: whole units, a point and exactly two digits, from integer cents only. */
export function formatMoney(cents: number): string {
  return formatScaled(BigInt(cents), 2);
}

/** The monthly figure of a yearly price, rounded half away from zero to whole cents. */
export function monthlyCents(cents: number): number {
  return Number(scaleRoundHalfAway(cents, 1n, 12n, 0));
}
