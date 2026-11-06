import {
  agencyCardDate,
  agencyClock,
  agencyDateOf,
  agencyDayHeading,
} from '../shared/time';

export const clock = (iso: string): string => agencyClock(new Date(iso));

export const cardDate = (iso: string): string => agencyCardDate(new Date(iso));

export const dayHeading = (iso: string): string => agencyDayHeading(new Date(iso));

export const dayKey = (iso: string): string => agencyDateOf(new Date(iso));

export const dateOnly = (iso: string): string => agencyDateOf(new Date(iso));

export const dateAndClock = (iso: string): string => `${dateOnly(iso)} ${clock(iso)}`;

/** The value a date-and-time textbox shows, in agency time. */
export const inputDateTime = (iso: string): string =>
  `${agencyDateOf(new Date(iso))}T${agencyClock(new Date(iso))}`;
