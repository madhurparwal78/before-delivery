import type { CredentialType, RequestStatus, Setting } from '../shared/types.js';

const AGENCY_TIME_ZONE = 'America/New_York';

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const monthDayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TIME_ZONE,
  month: 'short',
  day: 'numeric',
});

const weekdayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TIME_ZONE,
  weekday: 'short',
});

const longDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const zoneFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TIME_ZONE,
  timeZoneName: 'short',
});

const isoDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: AGENCY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Clock times always read in the agency time zone, whatever the browser's zone. */
export function clock(iso: string): string {
  return clockFormat.format(new Date(iso));
}

export function monthDay(iso: string): string {
  return monthDayFormat.format(new Date(iso));
}

export function weekday(iso: string): string {
  return weekdayFormat.format(new Date(iso));
}

export function zoneAbbreviation(iso: string): string {
  for (const part of zoneFormat.formatToParts(new Date(iso))) {
    if (part.type === 'timeZoneName') return part.value;
  }
  return '';
}

export function agencyIsoDate(value: Date | string): string {
  return isoDateFormat.format(typeof value === 'string' ? new Date(value) : value);
}

/** `Sun, Nov 1, 9:00 AM EST` */
export function cutoffText(iso: string): string {
  return `${weekday(iso)}, ${monthDay(iso)}, ${clock(iso)} ${zoneAbbreviation(iso)}`;
}

/** `Dec 31, 2030` from a plain `YYYY-MM-DD` expiry date. */
export function longDate(isoDate: string): string {
  return longDateFormat.format(new Date(`${isoDate}T12:00:00Z`));
}

export function timeWindow(startsAt: string, endsAt: string): string {
  return `${clock(startsAt)} to ${clock(endsAt)}`;
}

export function timeWindowWithZone(startsAt: string, endsAt: string): string {
  return `${timeWindow(startsAt, endsAt)} ${zoneAbbreviation(startsAt)}`;
}

export function addMinutesIso(startsAt: string, minutes: number): string {
  return new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString();
}

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Open seat',
  'half-staffed': 'Half-staffed',
  staffed: 'Staffed',
  completed: 'Completed',
  invoiced: 'Invoiced',
  cancelled_early: 'Cancelled',
  cancelled_late: 'Cancelled (late fee)',
};

export const SETTING_LABELS: Record<Setting, string> = {
  medical: 'Medical',
  education: 'Education',
  legal: 'Legal',
};

export const CREDENTIAL_OPTIONS: CredentialType[] = ['NIC', 'CDI', 'SC:L', 'EIPA'];

export function isCancelled(status: RequestStatus): boolean {
  return status === 'cancelled_early' || status === 'cancelled_late';
}

/** The Monday of the agency week containing the given agency date. */
export function weekMonday(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const asUtc = new Date(Date.UTC(year as number, (month as number) - 1, day as number));
  const weekdayIndex = asUtc.getUTCDay();
  asUtc.setUTCDate(asUtc.getUTCDate() - (weekdayIndex === 0 ? 6 : weekdayIndex - 1));
  return asUtc.toISOString().slice(0, 10);
}

export function shiftDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const asUtc = new Date(Date.UTC(year as number, (month as number) - 1, day as number));
  asUtc.setUTCDate(asUtc.getUTCDate() + days);
  return asUtc.toISOString().slice(0, 10);
}

export function labelForDate(isoDate: string): { weekday: string; monthDay: string } {
  const at = new Date(`${isoDate}T12:00:00Z`);
  return { weekday: weekdayFormat.format(at), monthDay: monthDayFormat.format(at) };
}
