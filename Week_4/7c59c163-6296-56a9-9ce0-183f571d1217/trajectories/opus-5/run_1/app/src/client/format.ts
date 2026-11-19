export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${remainder.toString().padStart(2, '0')}`;
}

export function formatInteger(value: number): string {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `<price>` is `<n>¢` on event markets and `<amount>` on pairs. */
export const formatPrice = (kind: 'pair' | 'event', price: number): string =>
  kind === 'event' ? `${price}¢` : formatAmount(price);

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthLabel(month: string): string {
  const index = Number.parseInt(month.slice(5), 10);
  return `${MONTHS[index - 1] as string} ${month.slice(0, 4)}`;
}

export function longDate(isoDate: string): string {
  const index = Number.parseInt(isoDate.slice(5, 7), 10);
  return `${Number.parseInt(isoDate.slice(8, 10), 10)} ${MONTHS[index - 1] as string} ${isoDate.slice(0, 4)}`;
}

export function inZone(timeZone: string, iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export const shortId = (id: string): string => id.slice(0, 8);
