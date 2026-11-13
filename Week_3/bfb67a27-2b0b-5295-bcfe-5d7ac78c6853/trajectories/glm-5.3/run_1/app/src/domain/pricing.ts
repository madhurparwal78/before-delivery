// The one place the house billable-day rules are decided (DP-02).

export type DayKind = 'billable' | 'free' | 'weekend';

export interface PricedDay {
  day: number;
  date: string;
  kind: DayKind;
}

export interface DayBreakdown {
  hireDays: number;
  billableDays: number;
  days: PricedDay[];
}

export function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function addDays(date: string, days: number): string {
  const utc = parseDate(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return formatDate(utc);
}

export function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayUtc(now: Date): string {
  return formatDate(now);
}

const WEEKDAY_NAMES: ReadonlyArray<string> = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekdayShort(date: string): string {
  return WEEKDAY_NAMES[parseDate(date).getUTCDay()] ?? '';
}

export function isFriday(date: string): boolean {
  return parseDate(date).getUTCDay() === 5;
}

export function rangesOverlap(pickupA: string, returnA: string, pickupB: string, returnB: string): boolean {
  return pickupA <= returnB && pickupB <= returnA;
}

export function billableDayBreakdown(pickupDate: string, returnDate: string): DayBreakdown {
  const hireDays = Math.round((parseDate(returnDate).getTime() - parseDate(pickupDate).getTime()) / 86400000);
  const days: PricedDay[] = [];
  const fridayWeekend = isFriday(pickupDate) && (hireDays === 2 || hireDays === 3);
  if (fridayWeekend) {
    for (let day = 1; day <= hireDays; day += 1) {
      days.push({ day, date: addDays(pickupDate, day - 1), kind: 'weekend' });
    }
    return { hireDays, billableDays: 1, days };
  }
  let billableDays = 0;
  for (let day = 1; day <= hireDays; day += 1) {
    const kind: DayKind = (day - 1) % 7 >= 3 ? 'free' : 'billable';
    if (kind === 'billable') {
      billableDays += 1;
    }
    days.push({ day, date: addDays(pickupDate, day - 1), kind });
  }
  return { hireDays, billableDays, days };
}

export interface KitRates {
  dayRateCents: number;
  depositCents: number;
}

export interface StoredPrice {
  billableDays: number;
  dayRateCents: number;
  hirePriceCents: number;
  depositCents: number;
  totalCents: number;
}

export function priceHire(pickupDate: string, returnDate: string, rates: KitRates): StoredPrice {
  const { billableDays } = billableDayBreakdown(pickupDate, returnDate);
  const hirePriceCents = billableDays * rates.dayRateCents;
  return {
    billableDays,
    dayRateCents: rates.dayRateCents,
    hirePriceCents,
    depositCents: rates.depositCents,
    totalCents: hirePriceCents + rates.depositCents,
  };
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${`${rest}`.padStart(2, '0')}`;
}
