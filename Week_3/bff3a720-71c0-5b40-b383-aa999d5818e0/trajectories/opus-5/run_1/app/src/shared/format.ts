const moneyFormat = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

/** Money for the screen, in the Irish English locale: €14.73. */
export function money(cents: number): string {
  return moneyFormat.format(cents / 100);
}

/** Wallet amounts carry a sign and use an ASCII hyphen-minus. */
export function signedMoney(cents: number): string {
  return cents < 0 ? `-${money(Math.abs(cents))}` : `+${money(cents)}`;
}

/** Euros with two decimals and a dot, without a symbol, for the CSV. */
export function plainAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
export const MONTHS_SHORT = [
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
export const MONTHS_LONG = [
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
] as const;

export function pluralise(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
