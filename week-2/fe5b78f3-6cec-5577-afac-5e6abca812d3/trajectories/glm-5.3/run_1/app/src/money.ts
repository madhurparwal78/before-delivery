// Money is integer paise everywhere; rounding happens only where Business rules name it.

/** Round half up to a whole number. */
export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

/** Rupees string with Indian digit grouping and exactly two decimals. */
export function formatPaise(paise: number): string {
  const neg = paise < 0;
  const whole = Math.floor(Math.abs(paise) / 100);
  const frac = String(Math.abs(paise) % 100).padStart(2, '0');
  const s = String(whole).replace(/(\d)(?=(\d\d)+\d$)/g, '$1,');
  return `${neg ? '-' : ''}₹${s}.${frac}`;
}

/** Paise to a rupees decimal string for Kill Bill, e.g. 179025 -> "1790.25". */
export function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}
