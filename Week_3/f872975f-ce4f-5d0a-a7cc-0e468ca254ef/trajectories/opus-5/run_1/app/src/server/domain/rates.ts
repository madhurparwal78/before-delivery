import { GRADES, SPECIES } from '../../shared/constants';
import { Queryable, rows } from '../db/pool';
import { ApiError } from '../errors';

export interface RateShape {
  species: string;
  grade: string;
  rate_cents: number;
  effective_at: string;
}

interface RateRow {
  species: string;
  grade: string;
  rate_cents: number;
  effective_at: Date;
}

const key = (species: string, grade: string): string => `${species}|${grade}`;

/** The rate versions in force at one instant. */
export class RateBook {
  private readonly byKey: Map<string, RateRow>;

  public constructor(inForce: RateRow[]) {
    this.byKey = new Map(inForce.map((row) => [key(row.species, row.grade), row]));
  }

  public rateFor(species: string, grade: string): number | null {
    return this.byKey.get(key(species, grade))?.rate_cents ?? null;
  }

  public shapes(): RateShape[] {
    return [...this.byKey.values()]
      .map((row) => ({
        species: row.species,
        grade: row.grade,
        rate_cents: row.rate_cents,
        effective_at: row.effective_at.toISOString()
      }))
      .sort((a, b) => a.species.localeCompare(b.species) || a.grade.localeCompare(b.grade));
  }
}

export async function ratesInForce(client: Queryable, at: Date): Promise<RateBook> {
  const found = await rows<RateRow>(
    client,
    `SELECT DISTINCT ON (species, grade) species, grade, rate_cents, effective_at
     FROM rate_versions WHERE effective_at <= $1
     ORDER BY species, grade, effective_at DESC, id DESC`,
    [at]
  );
  return new RateBook(found);
}

export async function scheduledRates(client: Queryable, at: Date): Promise<RateShape[]> {
  const found = await rows<RateRow>(
    client,
    `SELECT species, grade, rate_cents, effective_at FROM rate_versions
     WHERE effective_at > $1 ORDER BY effective_at ASC, species ASC, grade ASC`,
    [at]
  );
  return found.map((row) => ({
    species: row.species,
    grade: row.grade,
    rate_cents: row.rate_cents,
    effective_at: row.effective_at.toISOString()
  }));
}

const EFFECTIVE_FROM_MS = 60_000;
const EFFECTIVE_TO_MS = 365 * 24 * 60 * 60 * 1000;

/** Reads an optional effective-from instant, defaulting to now and bounded by the rate window. */
export function readEffectiveAt(value: unknown, now: Date): Date {
  if (value === undefined || value === null) return now;
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(value.trim())) {
    throw new ApiError('validation', { effective_at: 'Give an ISO 8601 time with a zone offset.' });
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError('validation', { effective_at: 'Give an ISO 8601 time with a zone offset.' });
  }
  const offset = parsed.getTime() - now.getTime();
  if (offset < -EFFECTIVE_FROM_MS || offset > EFFECTIVE_TO_MS) {
    throw new ApiError('validation', { effective_at: 'That time is outside the rate window.' });
  }
  return parsed;
}

export function isSpecies(value: unknown): boolean {
  return typeof value === 'string' && (SPECIES as readonly string[]).includes(value);
}

export function isGrade(value: unknown): boolean {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value);
}
