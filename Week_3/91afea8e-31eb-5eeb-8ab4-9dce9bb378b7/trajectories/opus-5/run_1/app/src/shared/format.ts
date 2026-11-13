/** Money and date rendering. Paise in, published strings out. */

export function formatAmount(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
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
  return `${negative ? '-' : ''}₹${grouped}.${fraction}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `2026-11-05` becomes `Thu 5 Nov`. */
export function formatPromiseDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map((part) => Number(part));
  const at = new Date(Date.UTC(year, month - 1, day));
  return `${WEEKDAYS[at.getUTCDay()]} ${day} ${MONTHS[month - 1]}`;
}
