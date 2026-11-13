/** Integer helpers: all money and length math uses exact integers. */

/** Round half up toward positive infinity for non-negative values (all our money/volumes are non-negative). */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('division by zero');
  if (numerator >= 0n) return (numerator * 2n + denominator) / (2n * denominator);
  return -roundHalfUp(-numerator, denominator);
}

/** Board feet: volume_mm3 / 2359737.216, rounded half up to two decimals, returned as a string like "3.74". */
export function boardFeetString(volumeMm3: number): string {
  // hundredths of a board foot = volume * 100 / 2359737.216, rounded half up
  const bfHundredths = roundHalfUp(BigInt(volumeMm3) * 100n * 1000n, 2359737216n);
  const whole = bfHundredths / 100n;
  const frac = bfHundredths % 100n;
  return `${whole}.${frac.toString().padStart(2, '0')}`;
}

/**
 * Price in integer cents: thickness * width * take * rate_cents * 1000 / 2359737216,
 * computed exactly and rounded half up to a whole cent once.
 */
export function priceCents(thicknessMm: number, widthMm: number, takeMm: number, rateCents: number): number {
  const numerator = BigInt(thicknessMm) * BigInt(widthMm) * BigInt(takeMm) * BigInt(rateCents) * 1000n;
  return Number(roundHalfUp(numerator, 2359737216n));
}

export function volumeMm3(lengthMm: number, widthMm: number, thicknessMm: number): number {
  return lengthMm * widthMm * thicknessMm;
}

/** Format integer cents as a plain decimal dollars string, e.g. 2349 -> "23.49". */
export function centsToDollars(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  return `${whole}.${String(frac).padStart(2, '0')}`;
}

/** Format integer cents with comma thousands separators in dollars, e.g. 1610 -> "16.10", 1234567 -> "12,345.67". */
export function centsToDisplay(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${frac}`;
}

/** Split a price into one line per piece by length, floored, remainder by largest remainder, ties to the earlier piece. */
export function allocateLines(
  price: number,
  pieces: ReadonlyArray<{ label: string; length_mm: number }>,
): Array<{ label: string; length_mm: number; amount_cents: number }> {
  const lengths = pieces.map((p) => BigInt(p.length_mm));
  const totalLength = lengths.reduce((a, b) => a + b, 0n);
  if (totalLength === 0n || pieces.length === 0) {
    return pieces.map((p) => ({ label: p.label, length_mm: p.length_mm, amount_cents: 0 }));
  }
  const priceBig = BigInt(price);
  const bases = lengths.map((l) => (priceBig * l) / totalLength);
  const remainders = lengths.map((l) => (priceBig * l) % totalLength);
  let remaining = priceBig - bases.reduce((a, b) => a + b, 0n);
  const order = pieces.map((_, i) => i).sort((a, b) => {
    if (remainders[b] !== remainders[a]) return Number(remainders[b] - remainders[a]);
    return a - b;
  });
  for (let i = 0; i < order.length && remaining > 0n; i += 1) {
    bases[order[i]] += 1n;
    remaining -= 1n;
  }
  return pieces.map((p, i) => ({ label: p.label, length_mm: p.length_mm, amount_cents: Number(bases[i]) }));
}
