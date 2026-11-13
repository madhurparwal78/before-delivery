/**
 * The one place that picks the edition which rules a claim. An edition rules only claims
 * confirmed from 00:00 Europe/London on its start date, so saving one never reaches back.
 */

import { londonDate, type LondonDate } from './time';

export interface Edition {
  code: string;
  title: string;
  startsOn: LondonDate;
  standardMonths: number;
  clubMonths: number;
  ownerContributionPercent: number;
}

export const EDITION_CODE_PATTERN = /^[A-Z0-9-]{3,20}$/;

/**
 * The edition with the latest start date on or before the business day of the confirmation
 * instant. Exactly one edition decides each claim.
 */
export function decidingEdition(editions: readonly Edition[], confirmedAt: Date): Edition | null {
  const businessDay = londonDate(confirmedAt);
  let decided: Edition | null = null;
  for (const edition of editions) {
    if (edition.startsOn <= businessDay && (decided === null || edition.startsOn > decided.startsOn)) {
      decided = edition;
    }
  }
  return decided;
}
