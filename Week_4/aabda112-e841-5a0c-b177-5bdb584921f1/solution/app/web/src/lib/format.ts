import { clinicDate, clinicHm, dayLabel, longDayLabel, dueLabel } from '../../../shared/clinictime';

export { longDayLabel, dueLabel };

/** `09:00` in clinic time, whatever zone the browser has. */
export const hm = (instant: string): string => clinicHm(new Date(instant));

/** `Tue 17 Nov` for an instant, in clinic time. */
export const instantDay = (instant: string): string => dayLabel(clinicDate(new Date(instant)));

export const pounds = (pence: number): string => {
  const whole = Math.trunc(pence / 100);
  return `£${whole.toLocaleString('en-GB')}.${String(pence % 100).padStart(2, '0')}`;
};

/** `1.5` hundred grams written as `12,400 g`. */
export const grams = (value: number | null): string => (value === null ? 'Not recorded' : `${value.toLocaleString('en-GB')} g`);

export const initials = (name: string): string =>
  name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

export const signed = (delta: number): string => (delta > 0 ? `+${delta}` : `${delta}`);

export function parsePence(input: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const pence = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return pence > 0 ? pence : null;
}
