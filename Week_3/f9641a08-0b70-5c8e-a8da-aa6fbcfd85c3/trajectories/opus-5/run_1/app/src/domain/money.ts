export function groupIndian(value: number): string {
  const negative = value < 0;
  const digits = String(Math.abs(Math.round(value)));
  let out: string;
  if (digits.length <= 3) {
    out = digits;
  } else {
    const last3 = digits.slice(-3);
    let rest = digits.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) parts.unshift(rest);
    out = `${parts.join(',')},${last3}`;
  }
  return negative ? `-${out}` : out;
}

export function rupees(value: number): string {
  return value < 0 ? `-₹${groupIndian(-value)}` : `₹${groupIndian(value)}`;
}

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istParts(at: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

export function formatDateIst(at: Date): string {
  const parts = istParts(at);
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

export function formatDateTimeIst(at: Date): string {
  const parts = istParts(at);
  const hh = String(parts.hour).padStart(2, '0');
  const mm = String(parts.minute).padStart(2, '0');
  return `${formatDateIst(at)}, ${hh}:${mm}`;
}

export function isoDateIst(at: Date): string {
  const parts = istParts(at);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function istDayStartUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+05:30`);
}

export function istDayEndUtc(isoDate: string): Date {
  return new Date(new Date(`${isoDate}T00:00:00+05:30`).getTime() + 24 * 60 * 60 * 1000 - 1);
}
