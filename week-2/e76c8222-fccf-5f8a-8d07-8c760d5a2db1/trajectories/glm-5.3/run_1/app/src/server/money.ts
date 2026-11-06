// Money is handled as integer cents everywhere; strings with two decimals only at the API edge.
export function centsToMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function moneyToCents(s: string): number | null {
  if (!/^-?\d+\.\d{2}$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [whole, frac] = (neg ? s.slice(1) : s).split('.');
  const cents = Number(whole) * 100 + Number(frac);
  return neg ? -cents : cents;
}

// Half-up rounding to whole cents for a value expressed in hundredths of a cent.
export function roundHalfUpCents(hundredths: number): number {
  return Math.sign(hundredths) * Math.round(Math.abs(hundredths) / 100);
}
