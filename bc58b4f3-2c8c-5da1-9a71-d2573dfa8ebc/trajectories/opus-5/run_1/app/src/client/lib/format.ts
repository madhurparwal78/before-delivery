import {
  centralDateKey,
  formatCentralDateTime,
  formatCentralDay,
  formatCentralTime,
  formatHoursMinutes,
  instantFromCentral,
} from '../../shared/centralTime';

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Awaiting release',
  released: 'Open',
  partially_covered: 'Partly covered',
  covered: 'Covered',
  served: 'Served',
  verified: 'Verified',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
};

export const ROLE_LABELS: Record<string, string> = {
  scheduler: 'Clinic scheduler',
  org_admin: 'Client org admin',
  dispatcher: 'Agency dispatcher',
  billing_lead: 'Agency billing lead',
  interpreter: 'Freelance interpreter',
};

export function dayText(iso: string): string {
  return formatCentralDay(new Date(iso));
}

export function dateTimeText(iso: string): string {
  return formatCentralDateTime(new Date(iso));
}

export function timeText(iso: string): string {
  return formatCentralTime(new Date(iso));
}

/** `Thu 12 Nov 09:00–10:30` */
export function rangeText(startIso: string, endIso: string): string {
  return `${formatCentralDateTime(new Date(startIso))}–${formatCentralTime(new Date(endIso))}`;
}

export function dateKey(iso: string): string {
  return centralDateKey(new Date(iso));
}

export function hoursMinutesNumeral(minutes: number): string {
  return formatHoursMinutes(minutes);
}

/** `2 h 05 m` */
export function hoursMinutesText(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} m`;
}

export function centralInstant(date: string, time: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (dateMatch === null || timeMatch === null) return null;
  return instantFromCentral(
    Number.parseInt(dateMatch[1] as string, 10),
    Number.parseInt(dateMatch[2] as string, 10),
    Number.parseInt(dateMatch[3] as string, 10),
    Number.parseInt(timeMatch[1] as string, 10),
    Number.parseInt(timeMatch[2] as string, 10),
  );
}
