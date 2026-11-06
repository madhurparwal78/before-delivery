const PROVINCE_FIRST_LETTERS: Record<string, string[]> = {
  AB: ['T'],
  BC: ['V'],
  MB: ['R'],
  NB: ['E'],
  NL: ['A'],
  NS: ['B'],
  NT: ['X'],
  NU: ['X'],
  ON: ['K', 'L', 'M', 'N', 'P'],
  PE: ['C'],
  QC: ['G', 'H', 'J'],
  SK: ['S'],
  YT: ['Y'],
};

export const CANADIAN_PROVINCES = [
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
];

export function normalizePostalCode(raw: string): string | null {
  const cleaned = raw.toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(cleaned)) return null;
  return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
}

export function postalCodeMatchesProvince(normalized: string, province: string): boolean {
  const letters = PROVINCE_FIRST_LETTERS[province];
  if (!letters) return false;
  return letters.includes(normalized[0]);
}

export function postalCodeFieldMessage(provinceName: string): string {
  return `Enter a postal code like A1A 1A1 for ${provinceName}.`;
}

function torontoDateParts(date: Date): { year: number; month: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

export function torontoNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
}

export function torontoYmd(date: Date): string {
  const { year, month } = torontoDateParts(date);
  const day = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', day: '2-digit' }).format(date)
  );
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatTorontoDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function formatTorontoDateTime(instant: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(instant).replace(',', ' at').replace(' 0', ' ');
}

export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day, 12));
  return result.toISOString().slice(0, 10);
}

export function billingPeriodMonths(billingPeriod: string): number {
  if (billingPeriod === 'MONTHLY') return 1;
  if (billingPeriod === 'BIMESTRIAL') return 2;
  if (billingPeriod === 'QUARTERLY') return 3;
  return 1;
}
