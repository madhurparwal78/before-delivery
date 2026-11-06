export type Locale = 'en' | 'fr';

function groups(digits: string, separator: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
    out += digits[i];
  }
  return out;
}

export function formatMoney(cents: number, locale: Locale): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = String(Math.trunc(abs / 100));
  const fraction = String(abs % 100).padStart(2, '0');
  if (locale === 'fr') {
    return `${negative ? '-' : ''}${groups(whole, ' ')},${fraction} $`;
  }
  return `${negative ? '-' : ''}$${groups(whole, ',')}.${fraction}`;
}

export function formatDollars(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  return `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
