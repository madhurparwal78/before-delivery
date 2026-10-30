/** Integer cents to the two-decimal dollar string billing is sent, with no floating-point step. */
export function minorToBillingAmount(minor: number): string {
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(3, '0');
  const dollars = digits.slice(0, -2);
  const cents = digits.slice(-2);
  return `${negative ? '-' : ''}${dollars}.${cents}`;
}

/** `$1,234.56` */
export function displayMoney(minor: number): string {
  const plain = minorToBillingAmount(minor);
  const negative = plain.startsWith('-');
  const [dollars = '0', cents = '00'] = (negative ? plain.slice(1) : plain).split('.');
  const grouped = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${cents}`;
}

/** Basis points as a two-decimal percent, for example `30.00`. */
export function displayPercent(basisPoints: number): string {
  return minorToBillingAmount(basisPoints);
}

/** A two-decimal percent string such as `25.00` to basis points, or null. */
export function parsePercentToBasisPoints(value: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const basisPoints = whole * 100 + Number(fraction);
  return basisPoints > 10000 ? null : basisPoints;
}

/** A dollar string such as `450.00` to integer cents, or null. */
export function parseDollarsToMinor(value: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim().replace(/,/g, ''));
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return Number(match[1]) * 100 + Number(fraction);
}
