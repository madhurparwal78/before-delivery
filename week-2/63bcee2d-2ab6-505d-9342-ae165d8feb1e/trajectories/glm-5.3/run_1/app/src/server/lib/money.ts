// Money: whole cents, one rounding rule (half-up), no floating point anywhere.

/** Round a rational (numerator/denominator) in cents to the nearest cent, half up. */
export function roundDivCents(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twiceRem = remainder * 2n;
  if (denominator < 0n) throw new Error('denominator must be positive');
  let result = quotient;
  if (twiceRem >= denominator) result += 1n;
  return Number(result);
}

/** Percentage of an amount in cents with basis points, rounded once, half up. */
export function percentOfCents(amountCents: number, basisPoints: number): number {
  return roundDivCents(BigInt(amountCents) * BigInt(basisPoints), 10000n);
}

/** Ten percent of an amount, rounded once, half up. */
export function tenPercentOfCents(amountCents: number): number {
  return roundDivCents(BigInt(amountCents), 10n);
}

/** Five percent of an amount, rounded once, half up. */
export function fivePercentOfCents(amountCents: number): number {
  return roundDivCents(BigInt(amountCents) * 5n, 100n);
}

/** Half of an amount, rounded once, half up. */
export function halfOfCents(amountCents: number): number {
  return roundDivCents(BigInt(amountCents), 2n);
}

export function amountText(currency: string, cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const frac = absolute % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `${grouped}.${frac.toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}${currency} ${text}`;
}

/** Serialize cents as a JSON decimal number string with exactly two places, e.g. 60000.00. */
export function centsToWireDecimal(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const frac = absolute % 100;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(2, '0')}`;
}

/** Split an amount across stores by weight, largest remainder, store-code tie-break. */
export function splitByWeight(
  amountCents: number,
  stores: { storeCode: string; storeName: string; weight: number }[],
): { storeCode: string; storeName: string; weight: number; amountCents: number }[] {
  const totalWeight = stores.reduce((sum, store) => sum + store.weight, 0);
  if (totalWeight === 0 || stores.length === 0) return [];
  const results = stores.map((store) => {
    const exact = (BigInt(amountCents) * BigInt(store.weight)) / BigInt(totalWeight);
    const remainder = (BigInt(amountCents) * BigInt(store.weight)) % BigInt(totalWeight);
    return {
      storeCode: store.storeCode,
      storeName: store.storeName,
      weight: store.weight,
      floorCents: Number(exact),
      remainder: remainder,
    };
  });
  let allocated = results.reduce((sum, r) => sum + r.floorCents, 0);
  let leftover = amountCents - allocated;
  const order = [...results].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      const cmp = b.remainder < a.remainder ? -1 : b.remainder > a.remainder ? 1 : 0;
      return cmp;
    }
    return a.storeCode < b.storeCode ? -1 : a.storeCode > b.storeCode ? 1 : 0;
  });
  let index = 0;
  while (leftover > 0 && order.length > 0) {
    order[index % order.length].floorCents += 1;
    leftover -= 1;
    index += 1;
  }
  return results.map((r) => ({
    storeCode: r.storeCode,
    storeName: r.storeName,
    weight: r.weight,
    amountCents: r.floorCents,
  }));
}
