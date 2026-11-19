/** Money helpers: exact decimal strings only, never floats (engineering standards). */

/** Cents (integer) → fixed decimal string with two places. */
export function centsToAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const units = Math.trunc(abs / 100);
  const rem = abs % 100;
  return `${sign}${units}.${rem.toString().padStart(2, '0')}`;
}

/** Decimal string → cents. Accepts "1234.5", "1234", "-12.34". Returns null if malformed. */
export function amountToCents(amount: string): number | null {
  const m = /^(-?)(\d{1,15})(?:\.(\d{1,10}))?$/.exec(amount);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const frac = m[3] === undefined ? '' : m[3];
  if (frac.length > 2) {
    if (frac.slice(2).replace(/0+$/, '') !== '') return null; // more than two decimals of value
  }
  const cents = Number(m[2]) * 100 + (frac === '' ? 0 : Number(frac.padEnd(2, '0').slice(0, 2)));
  return sign * cents;
}

/** The client-fee rule: "0" to "100000.00", 1–6 digits, optional 1–2 decimals. */
export function parseFee(raw: unknown): { ok: true; cents: number } | { ok: false } {
  if (typeof raw !== 'string' || !/^\d{1,6}(\.\d{1,2})?$/.test(raw)) return { ok: false };
  const cents = amountToCents(raw);
  if (cents === null || cents < 0 || cents > 10000000) return { ok: false };
  return { ok: true, cents };
}

/** A Kill Bill numeric amount at the boundary → exact integer cents. */
export function kbAmountToCents(n: number): number {
  return Math.round(n * 100);
}

/** Add two cent amounts. */
export function addCents(a: number, b: number): number {
  return a + b;
}
