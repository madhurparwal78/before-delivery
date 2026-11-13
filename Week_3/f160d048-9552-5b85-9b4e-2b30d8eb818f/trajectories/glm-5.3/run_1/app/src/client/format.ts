// Shared formatting and state helpers.
import { CITIES, MONTHS, PAY_BANDS, ROLE_FAMILIES, STAGES, WORK_PATTERNS, bandName, cityName, rangeText, roleName, rupees, stageName, workPatternName } from './reference.js';
import type { PayRow } from './types.js';

export {
  CITIES,
  MONTHS,
  PAY_BANDS,
  ROLE_FAMILIES,
  STAGES,
  WORK_PATTERNS,
  bandName,
  cityName,
  rangeText,
  roleName,
  rupees,
  stageName,
  workPatternName,
};

export function monthYear(ym: string): string {
  const [year, month] = ym.split('-');
  const index = Number.parseInt(month, 10) - 1;
  return `${MONTHS[index]} ${year}`;
}

export function countLine(total: number): string {
  if (total === 0) return 'No jobs match these filters';
  if (total === 1) return '1 job found';
  return `${total} jobs found`;
}

export function applicantLine(total: number): string {
  if (total === 0) return 'No applicants shown';
  if (total === 1) return '1 applicant shown';
  return `${total} applicants shown`;
}

export function newCountText(count: number): string {
  if (count === 0) return 'No new jobs';
  if (count === 1) return '1 new job';
  return `${count} new jobs`;
}

export function reviewCountText(count: number): string {
  if (count === 0) return 'No ratings yet';
  if (count === 1) return '1 review';
  return `${count} reviews`;
}

export function payRowReportsText(row: PayRow, unlocked: boolean): string {
  if (row.report_count < row.threshold) {
    return `${row.report_count} of ${row.threshold} reports. The range opens at ${row.threshold}.`;
  }
  if (!unlocked) return `${row.report_count} reports`;
  return `${row.report_count} reports`;
}

export function ratingText(value: number | null): string {
  return value === null ? 'No ratings yet' : value.toFixed(1);
}

export function stageLabel(stage: string): string {
  return stageName(stage);
}

export function outcomeText(outcome: string): string {
  if (outcome === 'offer') return 'Got an offer';
  if (outcome === 'no_offer') return 'No offer';
  return 'Never heard back';
}
