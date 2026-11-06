// Published copy and the formats it uses: comma numbers, amounts lists, local times in the saved zone.
import { RESOURCES, type Amounts } from '../shared/catalog';
import { ApiFailure } from './api';

export const fmt = (n: number): string => n.toLocaleString('en-US');

/** "<n> brine, <n> peat, <n> copper" for the non-zero resources, or "nothing". */
export function amountsText(a: Amounts): string {
  const parts = RESOURCES.filter((r) => a[r] !== 0).map((r) => `${fmt(a[r])} ${r}`);
  return parts.length === 0 ? 'nothing' : parts.join(', ');
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function parts(iso: string | number, zone: string): Record<string, string> {
  let f = partsCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    partsCache.set(zone, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** HH:MM, 24-hour, in the islander's saved zone. */
export function localTime(iso: string | number, zone: string): string {
  const p = parts(iso, zone);
  return `${p.hour}:${p.minute}`;
}

/** Like "Mon 15 Mar, 00:00" in the saved zone. */
export function localDateTime(iso: string | number, zone: string): string {
  const p = parts(iso, zone);
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

/** m:ss for a duration in milliseconds, never negative. */
export function mss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const SESSION_ENDED = 'Your session ended. Sign in again.';
export const SIGNED_OUT = 'You signed out.';
export const FLAT_NOTICE = '3D view unavailable — showing the flat plan.';
export const OUTAGE = 'The tide records are out of reach. Nothing was changed — try again in a moment.';

const GENERIC: Record<string, string> = {
  validation_failed: 'Check the highlighted fields.',
  not_found: "We couldn't find that. It may have moved, or it isn't yours to see.",
  csrf_failed: 'This page is out of date. Reload and try again.',
  email_not_verified: 'Confirm your email to raid and join clans.',
  database_unavailable: OUTAGE,
  not_in_clan: "You're no longer in this clan.",
};
const LOST_CONTACT = 'Lost contact with the server. Check your connection and try again.';

/** The Tide alerts copy for a failure: the action's own copy first, then the any-action copy. */
export function failureCopy(error: unknown, own: Record<string, string | ((f: ApiFailure) => string)> = {}): string {
  if (!(error instanceof ApiFailure)) return LOST_CONTACT;
  const specific = own[error.code];
  if (typeof specific === 'function') return specific(error);
  if (typeof specific === 'string') return specific;
  if (error.code === 'rate_limited') return `Too many tries. Try again in ${error.retryAfter ?? 1} s.`;
  return GENERIC[error.code] ?? LOST_CONTACT;
}

export const PLACE_ERRORS = {
  cell_occupied: 'That spot is taken.',
  building_limit_reached: 'Your island already holds the most of these.',
  insufficient_resources: 'Not enough resources for that.',
  no_free_builder: 'All builders are busy.',
};

export const START_RAID_ERRORS = {
  already_under_attack: 'Another raider got there first.',
  village_shielded: 'That island is shielded.',
  target_cooldown: 'You raided this island recently.',
  cannot_raid_self: "That's your own island.",
  raid_in_progress: 'Finish your current raid first.',
  no_army: 'Train some units first.',
};

export const RAID_ABANDONED = 'The finalize window closed. The raid was abandoned and nothing moved.';
export const WARDENS_ONLY = 'Only wardens can do that.';
export const ROLE_CHANGE_REFUSED = "That role change isn't allowed.";
export const REQUEST_CLOSED = 'That request is already filled or closed.';
export const ROLE_LABEL = { skipper: 'Skipper', mate: 'Mate', deckhand: 'Deckhand' } as const;
