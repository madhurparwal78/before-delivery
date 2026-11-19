import { londonParts } from '../../shared/format';

export type LocalStartProblem = 'malformed' | 'does_not_exist';

export interface LocalStartResolution {
  startsAt: Date | null;
  problem: LocalStartProblem | null;
}

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * The server alone turns a London wall clock into an instant. A time that does not
 * exist in London on that date is refused, and a time that occurs twice resolves to
 * the first occurrence.
 */
export const resolveLondonLocalStart = (localStart: string): LocalStartResolution => {
  const match = PATTERN.exec(localStart);
  if (match === null) return { startsAt: null, problem: 'malformed' };

  const [, year, month, day, hour, minute] = match.map(Number) as unknown as number[];
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const candidates: Date[] = [];
  for (const offsetMinutes of [60, 0]) {
    const instant = new Date(wanted - offsetMinutes * 60_000);
    const parts = londonParts(instant);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      candidates.push(instant);
    }
  }

  if (candidates.length === 0) return { startsAt: null, problem: 'does_not_exist' };
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return { startsAt: candidates[0], problem: null };
};

/** The London wall clock of an instant, written `YYYY-MM-DDTHH:mm`. */
export const toLondonLocalStart = (instant: Date): string => {
  const p = londonParts(instant);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
};
