/** All money is integer paise. All dates are plain `YYYY-MM-DD` strings in Asia/Kolkata. */

export type Paise = number;
export type IsoDate = string;

export interface ParsedIsoDate {
  y: number;
  m: number; // 1-12
  d: number;
}

export function parseIsoDate(s: IsoDate): ParsedIsoDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** Days since 1970-01-01 for a proleptic Gregorian civil calendar (no TZ math). */
export function civilToDay(y: number, m: number, d: number): number {
  // Howard Hinnant's algorithm, shifted to the civil calendar.
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function dayToCivil(n: number): ParsedIsoDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

export function isoToDay(s: IsoDate): number | null {
  const p = parseIsoDate(s);
  if (!p) return null;
  if (p.m === 2 && p.d === 29 && !isLeapYear(p.y)) return null;
  // reject non-existent civil dates
  if (dayToCivil(civilToDay(p.y, p.m, p.d)).d !== p.d) return null;
  return civilToDay(p.y, p.m, p.d);
}

export function dayToIso(n: number): IsoDate {
  const c = dayToCivil(n);
  return `${String(c.y).padStart(4, '0')}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Kolkata (Asia/Kolkata, fixed +05:30) — the only clock the domain reads. */
export function kolkataToday(now: Date): IsoDate {
  const shifted = new Date(now.getTime() + 330 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function kolkataYear(now: Date): number {
  return Number(kolkataToday(now).slice(0, 4));
}

export function kolkataIsoNow(now: Date): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().replace('Z', '+05:30');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Money — `Rs <rupees>` always with two decimals. */
export function rupeesString(paise: Paise): string {
  const sign = paise < 0 ? '-' : '';
  const a = Math.abs(paise);
  return `${sign}Rs ${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

export function rupeesPlain(paise: Paise): string {
  const a = Math.abs(paise);
  return `${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** Screen and PDF dates read `D Mon YYYY`. */
export function displayDate(iso: IsoDate): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${p.d} ${months[p.m - 1]} ${p.y}`;
}

/** Round half up on exact integers. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  const neg = numerator < 0;
  const a = Math.abs(numerator);
  const q = Math.floor((2 * a + denominator) / (2 * denominator));
  return neg ? -q : q;
}

/**
 * Unit sale price: rupees per ml under 1,000 ml, rupees per litre at 1,000 ml or
 * over, computed from the retail price and rounded half up to two decimals on
 * exact integers. Omitted when it equals the retail price, as at exactly
 * 1 litre, where the per-litre figure is the retail price itself.
 */
export function unitSalePrice(retailPaise: Paise, sizeMl: number): { rupees: string; per: 'ml' | 'litre' } | null {
  if (sizeMl >= 1000) {
    if (sizeMl === 1000) return null;
    return { rupees: rupeesPlain(divRoundHalfUp(retailPaise * 1000, sizeMl)), per: 'litre' };
  }
  return { rupees: rupeesPlain(divRoundHalfUp(retailPaise, sizeMl)), per: 'ml' };
}
