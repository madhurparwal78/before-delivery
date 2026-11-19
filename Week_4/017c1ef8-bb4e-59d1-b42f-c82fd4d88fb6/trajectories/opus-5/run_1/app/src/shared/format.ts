/** Published formatting rules, used by the server and the browser alike. */

export function codePoints(text: string): number {
  return [...text].length;
}

export function cutCodePoints(text: string, limit: number): string {
  return [...text].slice(0, limit).join('');
}

export function firstName(name: string): string {
  const space = name.indexOf(' ');
  return space === -1 ? name : name.slice(0, space);
}

export function withCommas(value: number): string {
  return value.toLocaleString('en-US');
}

function parts(instant: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) found[part.type] = part.value;
  return found;
}

/** `Mar 1, 2027` */
export function formatDate(instant: Date, timeZone: string): string {
  const p = parts(instant, timeZone);
  return `${p.month} ${p.day}, ${p.year}`;
}

/** `3:05 PM`, floored to the minute, one plain space before AM or PM. */
export function formatTime(instant: Date, timeZone: string): string {
  const p = parts(instant, timeZone);
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

export function formatDateTime(instant: Date, timeZone: string): string {
  return `${formatDate(instant, timeZone)} at ${formatTime(instant, timeZone)}`;
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) found[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(found.year),
    Number(found.month) - 1,
    Number(found.day),
    Number(found.hour) % 24,
    Number(found.minute),
    Number(found.second),
  );
  return asUtc - instant.getTime();
}

/** `YYYY-MM-DD HH:MM` typed in the configured zone, as a UTC instant. */
export function wallTimeToUtc(text: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const wall = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  let instant = wall - zoneOffsetMs(new Date(wall), timeZone);
  instant = wall - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant).toISOString();
}

/** A UTC instant as `YYYY-MM-DD HH:MM` in the configured zone. */
export function utcToWallTime(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) found[part.type] = part.value;
  const hour = found.hour === '24' ? '00' : found.hour;
  return `${found.year}-${found.month}-${found.day} ${hour}:${found.minute}`;
}

/** The published relative-time ladder; every division rounds down. */
export function relativeTime(createdIso: string, nowIso: string, timeZone: string): string {
  const created = new Date(createdIso);
  const now = new Date(nowIso);
  const seconds = Math.floor((now.getTime() - created.getTime()) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 28) return `${Math.floor(days / 7)}w`;
  return formatDate(created, timeZone);
}

/** The composer counter. */
export function counterText(used: number, limit: number): string {
  if (used > limit) return `${used - limit} over the limit`;
  return `${used} / ${limit}`;
}

export const DEGREE_LABELS: Record<string, string> = {
  '1': '1st',
  '2': '2nd',
  '3': '3rd+',
  out: 'Out of network',
};

export const DEGREE_NUMERALS: Record<string, string> = {
  '1': '1',
  '2': '2',
  '3': '3',
  out: '—',
};

export function mutualLineText(count: number, named: string | null): string {
  if (count === 0) return '';
  if (count === 1) return '1 mutual connection';
  if (count === 2) return `${named} and 1 other mutual connection`;
  return `${named} and ${count - 1} other mutual connections`;
}

export function skillRowText(name: string, endorsements: number): string {
  if (endorsements === 0) return `${name} · No endorsements yet`;
  if (endorsements === 1) return `${name} · 1 endorsement`;
  return `${name} · ${endorsements} endorsements`;
}

export const REACTION_TYPES = ['like', 'celebrate', 'support', 'insightful', 'funny'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const REACTION_LABELS: Record<ReactionType, string> = {
  like: 'Like',
  celebrate: 'Celebrate',
  support: 'Support',
  insightful: 'Insightful',
  funny: 'Funny',
};

export const WORKPLACE_LABELS: Record<string, string> = {
  'on-site': 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

export const STAGE_ORDER = [
  'applied',
  'viewed',
  'interviewing',
  'offered',
  'rejected',
  'withdrawn',
] as const;
export type ApplicationState = (typeof STAGE_ORDER)[number];

export const STAGE_LABELS: Record<string, string> = {
  applied: 'Applied',
  viewed: 'Viewed',
  interviewing: 'Interviewing',
  offered: 'Offered',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const STAGE_STATUS_TEXT: Record<string, string> = {
  applied: 'Application submitted',
  viewed: 'Viewed by the hiring team',
  interviewing: 'Interviewing',
  offered: 'Offer extended',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};
