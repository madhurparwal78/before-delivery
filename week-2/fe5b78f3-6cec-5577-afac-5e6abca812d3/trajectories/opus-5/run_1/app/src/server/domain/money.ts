/** Money is integer paise everywhere. */
export type Paise = number;

export const RUPEE: Paise = 100;

/** Rounds half up to whole paise. */
export function roundHalfUp(value: number): Paise {
  return Math.floor(value + 0.5);
}

/** `₹1,23,456.00` — rupees with Indian digit grouping and exactly two decimals. */
export function formatMoney(paise: Paise): string {
  const sign = paise < 0 ? '-' : '';
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  const digits = String(rupees);
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    let rest = digits.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) parts.unshift(rest);
    grouped = `${parts.join(',')},${last3}`;
  }
  return `${sign}₹${grouped}.${fraction}`;
}
