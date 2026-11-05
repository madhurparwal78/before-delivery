import { config } from '../config.js';

export const VENUE_ZONE = 'America/Chicago';

/** Last day for new deposits, the balance-due date and the last refund day. */
export const RESERVE_BY_DATE = '2027-03-19';
export const REFUND_FEE_CUTOFF_DATE = '2027-01-15';
export const REMINDER_21_DATE = '2027-02-26';
export const REMINDER_7_DATE = '2027-03-12';
export const DAY1_DATE = '2027-04-16';
export const DAY2_DATE = '2027-04-17';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: VENUE_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The real server clock, used for holds, offers and `server_time`. */
export function serverNow(): Date {
  return new Date();
}

/** The instant every calendar rule is measured from. */
export function calendarNow(): Date {
  if (config.benchDaysNow === null) return new Date();
  const frozen = new Date(config.benchDaysNow);
  if (Number.isNaN(frozen.getTime())) {
    throw new Error('BENCH_DAYS_NOW must be an ISO 8601 instant');
  }
  return frozen;
}

/** The venue-local calendar date (America/Chicago) of an instant, as YYYY-MM-DD. */
export function venueDateOf(at: Date): string {
  return dateFormatter.format(at);
}

/** The venue-local date every calendar rule uses. */
export function venueDate(): string {
  return venueDateOf(calendarNow());
}

export function depositsOpen(onVenueDate: string = venueDate()): boolean {
  return onVenueDate <= RESERVE_BY_DATE;
}

export function openCheckinDay(onVenueDate: string = venueDate()): 1 | 2 | null {
  if (onVenueDate === DAY1_DATE) return 1;
  if (onVenueDate === DAY2_DATE) return 2;
  return null;
}
