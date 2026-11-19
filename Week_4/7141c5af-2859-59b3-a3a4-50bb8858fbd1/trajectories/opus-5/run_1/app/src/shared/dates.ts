/**
 * Dates on the client page and in its mail, in the published form for each
 * language. Numbers always print in Latin digits.
 */
import type { Language } from './language.ts';

export interface DateParts {
  year: number;
  month: number;
  day: number;
  /** 1 = Monday through 7 = Sunday. */
  weekday: number;
}

const EN_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const IT_DAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const IT_MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

const JA_DAYS = ['\u6708', '\u706b', '\u6c34', '\u6728', '\u91d1', '\u571f', '\u65e5'];

const AR_DAYS = [
  '\u0627\u0644\u0627\u062b\u0646\u064a\u0646',
  '\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621',
  '\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621',
  '\u0627\u0644\u062e\u0645\u064a\u0633',
  '\u0627\u0644\u062c\u0645\u0639\u0629',
  '\u0627\u0644\u0633\u0628\u062a',
  '\u0627\u0644\u0623\u062d\u062f',
];
const AR_MONTHS = [
  '\u064a\u0646\u0627\u064a\u0631',
  '\u0641\u0628\u0631\u0627\u064a\u0631',
  '\u0645\u0627\u0631\u0633',
  '\u0623\u0628\u0631\u064a\u0644',
  '\u0645\u0627\u064a\u0648',
  '\u064a\u0648\u0646\u064a\u0648',
  '\u064a\u0648\u0644\u064a\u0648',
  '\u0623\u063a\u0633\u0637\u0633',
  '\u0633\u0628\u062a\u0645\u0628\u0631',
  '\u0623\u0643\u062a\u0648\u0628\u0631',
  '\u0646\u0648\u0641\u0645\u0628\u0631',
  '\u062f\u064a\u0633\u0645\u0628\u0631',
];

/** The published date form for a language. */
export function formatDate(parts: DateParts, language: Language): string {
  const { year, month, day, weekday } = parts;
  switch (language) {
    case 'en':
      return `${EN_DAYS[weekday - 1]} ${day} ${EN_MONTHS[month - 1]} ${year}`;
    case 'it':
      return `${IT_DAYS[weekday - 1]} ${day} ${IT_MONTHS[month - 1]} ${year}`;
    case 'ja':
      return `${year}\u5e74${month}\u6708${day}\u65e5(${JA_DAYS[weekday - 1]})`;
    case 'ar':
      return `${AR_DAYS[weekday - 1]} ${day} ${AR_MONTHS[month - 1]} ${year}`;
  }
}
