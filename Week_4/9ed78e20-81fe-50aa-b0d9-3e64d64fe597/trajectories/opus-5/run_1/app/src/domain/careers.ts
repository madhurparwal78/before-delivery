import type { Queryable } from '../db/pool.js';
import { londonToday } from './london.js';

export type Discipline = 'research' | 'engineering' | 'policy' | 'operations';
export type OfficeCode = 'london' | 'edinburgh' | 'zurich' | 'toronto';
export type RegionCode = 'uk' | 'europe' | 'north-america';

export const DISCIPLINES: readonly { value: Discipline; label: string }[] = [
  { value: 'research', label: 'Research' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'policy', label: 'Policy' },
  { value: 'operations', label: 'Operations' },
];

export const OFFICES: readonly { value: OfficeCode; label: string; region: RegionCode }[] = [
  { value: 'london', label: 'London', region: 'uk' },
  { value: 'edinburgh', label: 'Edinburgh', region: 'uk' },
  { value: 'zurich', label: 'Zurich', region: 'europe' },
  { value: 'toronto', label: 'Toronto', region: 'north-america' },
];

export const REGIONS: readonly { value: RegionCode; label: string }[] = [
  { value: 'uk', label: 'United Kingdom' },
  { value: 'europe', label: 'Europe' },
  { value: 'north-america', label: 'North America' },
];

export function findOffice(value: string): (typeof OFFICES)[number] | undefined {
  return OFFICES.find((office) => office.value === value);
}

export function officeLabel(value: string): string {
  return findOffice(value)?.label ?? value;
}

export function regionOfOffice(value: string): RegionCode | undefined {
  return findOffice(value)?.region;
}

export function regionLabel(value: string): string {
  return REGIONS.find((region) => region.value === value)?.label ?? value;
}

export function isDiscipline(value: string): value is Discipline {
  return DISCIPLINES.some((discipline) => discipline.value === value);
}

export function isRegion(value: string): value is RegionCode {
  return REGIONS.some((region) => region.value === value);
}

export type BenefitsEntry = {
  readonly id: string;
  readonly effective_from: string;
  readonly summary: string;
};

/** The entry with the latest effective-from date on or before today in London. */
export async function benefitsInForce(
  tx: Queryable,
  region: string,
): Promise<BenefitsEntry | null> {
  const result = await tx.query<BenefitsEntry>(
    `SELECT id, effective_from::text AS effective_from, summary
       FROM benefits_entries
      WHERE region = $1 AND effective_from <= $2::date
      ORDER BY effective_from DESC
      LIMIT 1`,
    [region, londonToday()],
  );
  return result.rows[0] ?? null;
}
