/**
 * Formatting shared by the server's pages and the browser's in-place language switch, so
 * both render the published formats from the same source.
 *
 * Every date and time here is an instant shown on the Europe/London calendar. The zone is
 * always named, so a device's own clock and time zone never change what is shown.
 */

export const WORKSHOP_ZONE = 'Europe/London';

export type Language = 'en-GB' | 'pl-PL';

export const LANGUAGES: readonly Language[] = ['en-GB', 'pl-PL'];

export function isLanguage(value: unknown): value is Language {
  return value === 'en-GB' || value === 'pl-PL';
}

const MONTHS: Record<Language, readonly string[]> = {
  'en-GB': [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  // Polish names a date with the month in the genitive.
  'pl-PL': [
    'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
    'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
  ],
};

const NO_BREAK_SPACE = '\u00a0';

/**
 * English puts the sign first and always groups thousands. Polish uses a decimal comma,
 * puts the sign after the amount behind a no-break space, and groups thousands with a
 * no-break space only from five digits up.
 */
export function formatMoney(minor: number, language: Language): string {
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const units = String(Math.floor(absolute / 100));
  const pennies = String(absolute % 100).padStart(2, '0');
  const sign = negative ? '-' : '';

  if (language === 'en-GB') {
    return `${sign}£${units.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${pennies}`;
  }
  const grouped = units.length >= 5 ? units.replace(/\B(?=(\d{3})+(?!\d))/g, NO_BREAK_SPACE) : units;
  return `${sign}${grouped},${pennies}${NO_BREAK_SPACE}£`;
}

/** A `YYYY-MM-DD` Europe/London calendar date in the language's long form. */
export function formatDate(date: string, language: Language): string {
  const [year, month, day] = date.split('-');
  const monthName = MONTHS[language][Number(month) - 1] ?? month ?? '';
  return `${Number(day)} ${monthName} ${year}`;
}

interface WallClock {
  date: string;
  time: string;
}

function londonWallClock(instant: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: WORKSHOP_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  // Midnight is formatted as hour 24 by some builds; the day has already rolled.
  const hour = String(Number(read('hour')) % 24).padStart(2, '0');
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${hour}:${read('minute')}`,
  };
}

/** The instant's Europe/London date, in the language's long form. */
export function formatInstantDate(instant: string, language: Language): string {
  return formatDate(londonWallClock(instant).date, language);
}

/** The instant's Europe/London hour and minute, 24-hour, with seconds dropped, never rounded. */
export function formatInstantTime(instant: string): string {
  return londonWallClock(instant).time;
}
