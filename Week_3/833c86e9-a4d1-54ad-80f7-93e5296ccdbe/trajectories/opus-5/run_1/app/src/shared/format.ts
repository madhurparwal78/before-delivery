import { Cur, Lang } from './types';
import { minorToMajor } from './money';
import { CURRENCY_DECIMALS } from './types';

const LOCALE: Record<Lang, string> = { en: 'en-GB', de: 'de-DE', ar: 'ar-KW' };

export function localeOf(lang: Lang): string {
  return LOCALE[lang] + '-u-nu-latn';
}

export function fmtMoney(lang: Lang, minor: number, cur: Cur): string {
  const d = CURRENCY_DECIMALS[cur];
  return new Intl.NumberFormat(localeOf(lang), {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(minorToMajor(minor, cur));
}

export function fmtDecimal1(lang: Lang, value: number): string {
  return new Intl.NumberFormat(localeOf(lang), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}


function noonUtcOf(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map((v) => Number(v));
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function dateParts(lang: Lang, zone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(localeOf(lang), { ...opts, timeZone: zone });
}

/** {date}: weekday long, day numeric, month long, year numeric. */
export function fmtLongDate(lang: Lang, isoDate: string, zone: string): string {
  return dateParts(lang, zone, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(noonUtcOf(isoDate));
}

/** {day month} */
export function fmtDayMonth(lang: Lang, isoDate: string, zone: string): string {
  return dateParts(lang, zone, { day: 'numeric', month: 'long' }).format(noonUtcOf(isoDate));
}

/** {weekday day month} */
export function fmtWeekdayDayMonth(lang: Lang, isoDate: string, zone: string): string {
  return dateParts(lang, zone, { weekday: 'long', day: 'numeric', month: 'long' }).format(noonUtcOf(isoDate));
}

/** {month year} from a YYYY-MM-DD date. */
export function fmtMonthYear(lang: Lang, isoDate: string, zone: string): string {
  return dateParts(lang, zone, { month: 'long', year: 'numeric' }).format(noonUtcOf(isoDate));
}

/** {moment}: weekday, day, month, year, hour and minute two-digit, 24-hour. */
export function fmtMoment(lang: Lang, instant: string, zone: string): string {
  return new Intl.DateTimeFormat(localeOf(lang), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zone,
  }).format(new Date(instant));
}

/** Long weekday names, starting at the language's week start. */
export function weekdayNames(lang: Lang): { iso: number; name: string }[] {
  const start = weekStart(lang);
  const fmt = new Intl.DateTimeFormat(localeOf(lang), { weekday: 'long', timeZone: 'UTC' });
  const out: { iso: number; name: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = ((start - 1 + i) % 7) + 1;
    // 2024-01-01 is a Monday (ISO 1).
    const d = new Date(Date.UTC(2024, 0, iso, 12));
    out.push({ iso, name: fmt.format(d) });
  }
  return out;
}

/** Monday (1) for en and de, Saturday (6) for ar. */
export function weekStart(lang: Lang): number {
  return lang === 'ar' ? 6 : 1;
}

export function pluralCategory(lang: Lang, n: number): Intl.LDMLPluralRule {
  return new Intl.PluralRules(LOCALE[lang]).select(n);
}
