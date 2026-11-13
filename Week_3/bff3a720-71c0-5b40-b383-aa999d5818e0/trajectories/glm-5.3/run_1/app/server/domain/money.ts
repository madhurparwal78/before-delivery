export const BRUSSELS_TZ = 'Europe/Brussels';

const EUR = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

export function money(cents: number): string {
  return EUR.format(cents / 100);
}

export function signedMoney(cents: number): string {
  return (cents < 0 ? '-' : '+') + EUR.format(Math.abs(cents) / 100);
}

export function csvMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}
