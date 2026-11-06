/** Money is integer cents everywhere; it becomes dollars only when formatted. */

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${String(remainder).padStart(2, '0')}`;
}

/** Kill Bill takes decimal dollars; build the string from cents without floating point. */
export function centsToDollarString(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const remainder = cents % 100;
  return `${dollars}.${String(remainder).padStart(2, '0')}`;
}

/** Parses the dollars-and-cents text of the damage charge field into whole cents. */
export function parseDollarsToCents(text: string): number | null {
  const match = /^\s*\$?\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(text.replace(/,/g, ''));
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return whole * 100 + Number(fraction);
}
