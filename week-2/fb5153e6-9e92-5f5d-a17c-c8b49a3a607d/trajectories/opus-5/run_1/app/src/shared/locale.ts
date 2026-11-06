export type Locale = 'en' | 'de';

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'de';
}

/** Reads the `lang` query value. Anything else, including absent, reads English. */
export function localeFromLang(lang: string | null | undefined): Locale {
  return lang === 'de' ? 'de' : 'en';
}

const EN_MONTHS = [
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

function groupInteger(digits: string, thousands: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += thousands;
    out += digits[i];
  }
  return out;
}

/** Splits a non-negative decimal string into grouped integer and fraction parts. */
function parts(value: string, thousands: string, decimal: string): string {
  const dot = value.indexOf('.');
  const int = dot === -1 ? value : value.slice(0, dot);
  const frac = dot === -1 ? '' : value.slice(dot + 1);
  const grouped = groupInteger(int, thousands);
  return frac === '' ? grouped : `${grouped}${decimal}${frac}`;
}

/** `€1,234.56` in English, `1.234,56 €` with a no-break space in German. */
export function formatAmount(cents: number, locale: Locale): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const body = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  if (locale === 'de') {
    return `${negative ? '-' : ''}${parts(body, '.', ',')}\u00a0€`;
  }
  return `${negative ? '-' : ''}€${parts(body, ',', '.')}`;
}

/** `1,234.5` in English, `1.234,5` in German. Used for camera numerals and counts. */
export function formatNumber(value: number, locale: Locale, decimals?: number): string {
  const negative = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);
  const body = decimals === undefined ? String(abs) : abs.toFixed(decimals);
  const sign = negative && Number.parseFloat(body) !== 0 ? '-' : '';
  if (locale === 'de') return `${sign}${parts(body, '.', ',')}`;
  return `${sign}${parts(body, ',', '.')}`;
}

/** `2 Nov 2026` in English, `02.11.2026` in German, from a `YYYY-MM-DD` date. */
export function formatDate(isoDate: string, locale: Locale): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  if (y === undefined || m === undefined || d === undefined) return isoDate;
  if (locale === 'de') return `${d}.${m}.${y}`;
  const month = EN_MONTHS[Number.parseInt(m, 10) - 1] ?? m;
  return `${Number.parseInt(d, 10)} ${month} ${y}`;
}

export function isReceiptPath(pathname: string): boolean {
  return pathname.startsWith('/receipts/');
}

/** Keeps the address's `lang` value on an internal link or redirect. */
export function withLang(path: string, lang: string | null): string {
  if (lang === null) return path;
  const [base, existing] = path.split('?', 2);
  const search = new URLSearchParams(existing ?? '');
  search.set('lang', lang);
  const qs = search.toString();
  return qs === '' ? (base ?? path) : `${base}?${qs}`;
}
