export function formatDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}${whole.toLocaleString('en-US')}.${fraction}`;
}

export function formatMoney(cents: number): string {
  return `$${formatDollars(cents)}`;
}

export function centsToKillBillAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Parse decimal dollar input using whole cents, without floating point rounding. */
export function dollarsToCents(value: string): number | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim().replace(/,/g, ''));
  if (match === null) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return match[1] === '-' ? -cents : cents;
}
