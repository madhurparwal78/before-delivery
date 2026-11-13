/**
 * The one place that works out the aftercare term and rules a claim inside or outside.
 * The ruling is made once, at identification, and nothing ever changes it.
 */

import { config } from '../config';
import type { Edition } from './editions';
import { addLondonMonths, isBefore, londonDate, startOfLondonDay, type LondonDate } from './time';

export interface Ruling {
  inside: boolean;
  edition: string;
  coverEndsAt: Date;
  coverEndsOn: LondonDate;
  termMonths: number | null;
}

export interface RulingInput {
  purchaseDate: LondonDate;
  clubMember: boolean;
  edition: Edition;
  startedAt: Date;
  confirmedAt: Date;
}

/**
 * Cover ends at 00:00 Europe/London at the start of the anniversary day, which is the
 * purchase date plus the term in calendar months. `AFTERCARE_TERM_SECONDS_OVERRIDE`
 * replaces that rule by ending cover a fixed number of seconds after the claim started.
 */
export function coverEnd(input: RulingInput): { endsAt: Date; termMonths: number | null } {
  if (config.aftercareTermSecondsOverride !== null) {
    return {
      endsAt: new Date(input.startedAt.getTime() + config.aftercareTermSecondsOverride * 1000),
      termMonths: null,
    };
  }
  const months = input.clubMember ? input.edition.clubMonths : input.edition.standardMonths;
  return { endsAt: startOfLondonDay(addLondonMonths(input.purchaseDate, months)), termMonths: months };
}

/** Inside when the confirmation instant is before the cover end, outside at or after it. */
export function ruleClaim(input: RulingInput): Ruling {
  const { endsAt, termMonths } = coverEnd(input);
  return {
    inside: isBefore(input.confirmedAt, endsAt),
    edition: input.edition.code,
    coverEndsAt: endsAt,
    coverEndsOn: londonDate(endsAt),
    termMonths,
  };
}
