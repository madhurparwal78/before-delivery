function group(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Irish English euro format from integer cents: €14.73, €0.00, €1,200.00. */
export function euros(cents: number): string {
  const abs = Math.abs(cents);
  const text = `€${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${text}` : text;
}

/** Wallet amounts carry an ASCII sign: +€7.36 or -€14.73. */
export function signedEuros(cents: number): string {
  return `${cents < 0 ? "-" : "+"}${euros(Math.abs(cents))}`;
}

export function plural(count: number, word: string): string {
  return count === 1 ? `${count} ${word}` : `${count} ${word}s`;
}

/** floor(whole-route price × segment km ÷ route km), in cents. The one segment price rule. */
export function segmentPriceCents(wholeRouteCents: number, segmentKm: number, routeKm: number): number {
  return Math.floor((wholeRouteCents * segmentKm) / routeKm);
}

/** Round cents half up to the nearest 50: the one rounding used for the recommended range and the price stepper. */
export function roundHalfUp50(cents: number): number {
  return Math.floor((cents + 25) / 50) * 50;
}
