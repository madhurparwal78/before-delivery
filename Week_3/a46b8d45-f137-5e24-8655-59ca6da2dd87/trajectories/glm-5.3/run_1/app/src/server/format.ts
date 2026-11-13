// Published formats. Dates and money follow the en-GB and pl-PL shapes.
import { londonWall, pad2 } from './clock.js';

export type Language = 'en-GB' | 'pl-PL';

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const PL_MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

export function formatDate(date: string, lang: Language): string {
  const parts = date.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  if (lang === 'pl-PL') return `${d} ${PL_MONTHS_GEN[m - 1]} ${y}`;
  return `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

/** The instant's Europe/London hour and minute, seconds dropped. */
export function formatTime(epochMs: number): string {
  const w = londonWall(epochMs);
  return `${pad2(w.hour)}:${pad2(w.minute)}`;
}

/** Money in the language's format. English: £4.33, £1,234.50.
 * Polish: 4,33 £, 1234,50 £, 12 345,00 £ (grouping from five digits up). */
export function formatMoney(minor: number, lang: Language): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const pennies = abs % 100;
  const p2 = pad2(pennies);
  const wholeStr = String(whole);
  if (lang === 'pl-PL') {
    let grouped = wholeStr;
    if (wholeStr.length >= 5) {
      const groups: string[] = [];
      const head = wholeStr.length % 3;
      let rest = wholeStr;
      if (head > 0) {
        groups.push(rest.slice(0, head));
        rest = rest.slice(head);
      }
      while (rest.length > 0) {
        groups.push(rest.slice(0, 3));
        rest = rest.slice(3);
      }
      grouped = groups.join('\u00a0');
    }
    return `${sign}${grouped},${p2}\u00a0£`;
  }
  const groups: string[] = [];
  let rest = wholeStr;
  while (rest.length > 3) {
    groups.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  groups.unshift(rest);
  return `${sign}£${groups.join(',')}.${p2}`;
}

export function formatLength(mm: number, lang: Language): string {
  const s = String(mm);
  if (lang === 'pl-PL') return `${s} mm`;
  const groups: string[] = [];
  let rest = s;
  while (rest.length > 3) {
    groups.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  groups.unshift(rest);
  return `${groups.join(',')} mm`;
}

export function formatWeight(g: number, lang: Language): string {
  const s = String(g);
  if (lang === 'pl-PL') return `${s} g`;
  const groups: string[] = [];
  let rest = s;
  while (rest.length > 3) {
    groups.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  groups.unshift(rest);
  return `${groups.join(',')} g`;
}

/** The link-lifetime line, shared by the sent page and the confirmation email.
 * The server renders it so the browser never consults its own clock. */
export function linkLifetimeLine(confirmBy: number, lang: Language): string {
  const w = londonWall(confirmBy);
  const date = `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
  const time = formatTime(confirmBy);
  if (lang === 'pl-PL') return `Link działa do ${time} dnia ${formatDate(date, 'pl-PL')} (czas brytyjski).`;
  return `This link works until ${time} on ${formatDate(date, 'en-GB')} (UK time).`;
}

/** English-only formats: operator screens and dispatch notes. */
export function formatMoneyEn(minor: number): string {
  return formatMoney(minor, 'en-GB');
}
export function formatDateEn(date: string): string {
  return formatDate(date, 'en-GB');
}
