import { createHash } from 'node:crypto';
import type { Version } from './errors';

// The published objects of each version, keys in order. The contract digests hash these lines
// together with the route table the server actually dispatches on.

const OBJECTS: Record<Version, Record<string, readonly string[]>> = {
  v1: {
    account: ['id', 'name', 'email', 'role'],
    auth: ['token', 'account'],
    signed_out: ['signed_out'],
    stage: ['slug', 'name', 'description'],
    session: ['id', 'day', 'date', 'starts_at', 'ends_at', 'starts_at_utc', 'ends_at_utc', 'title', 'speakers', 'stage',
      'stage_name', 'location', 'format', 'format_label', 'description', 'capacity', 'seats_left', 'waitlist_count',
      'reserved_by_me', 'saved_by_me', 'waitlist_position'],
    speaker_ref: ['name', 'company'],
    speaker: ['name', 'company', 'sessions'],
    reservation: ['id', 'session_id', 'created_at'],
    reservation_created: ['reservation', 'seats_left'],
    cancelled: ['seats_left'],
    waitlist: ['session_id', 'position', 'created_at'],
    waitlist_joined: ['waitlist'],
    waitlist_left: ['waitlisted'],
    saved: ['saved'],
    my_agenda: ['reserved', 'waitlisted', 'saved'],
    organiser_row: ['id', 'title', 'day', 'starts_at', 'ends_at', 'capacity', 'reserved', 'seats_left', 'waitlisted'],
    roster_row: ['name', 'email', 'reserved_at'],
    record: ['status', 'closes_at', 'guess_count', 'my_guess', 'final_figure', 'revealed_at', 'leaderboard'],
    guess: ['value', 'created_at'],
    guess_created: ['guess'],
    reveal: ['status', 'final_figure', 'revealed_at', 'leaderboard'],
    leader: ['rank', 'display_name', 'value', 'distance'],
    error: ['error', 'message'],
  },
  v2: {
    account: ['id', 'name', 'email', 'role'],
    auth: ['token', 'account'],
    signed_out: ['signed_out'],
    stage: ['slug', 'name', 'description'],
    seats: ['capacity', 'reserved', 'held', 'left'],
    hold: ['session_id', 'held_until', 'seconds_remaining'],
    session: ['id', 'day', 'date', 'start_local', 'end_local', 'start_instant', 'end_instant', 'title', 'speakers', 'stage',
      'stage_name', 'location', 'format', 'format_label', 'description', 'seats', 'waitlist_count', 'reserved_by_me',
      'saved_by_me', 'waitlist_position', 'my_hold'],
    speaker_ref: ['name', 'company'],
    speaker: ['slug', 'name', 'company', 'sessions', 'bio', 'bio_html'],
    reservation: ['id', 'session_id', 'created_at'],
    reservation_created: ['reservation', 'seats'],
    cancelled: ['seats'],
    released: ['held'],
    waitlist: ['session_id', 'position', 'created_at'],
    waitlist_joined: ['waitlist'],
    waitlist_left: ['waitlisted'],
    saved: ['saved'],
    my_agenda: ['reserved', 'held', 'waitlisted', 'saved'],
    organiser_row: ['id', 'title', 'day', 'start_local', 'end_local', 'seats', 'waitlisted'],
    roster_row: ['name', 'email', 'reserved_at'],
    record: ['status', 'closes_at', 'guess_count', 'my_guess', 'final_figure', 'revealed_at', 'leaderboard'],
    guess: ['value', 'created_at'],
    guess_created: ['guess'],
    reveal: ['status', 'final_figure', 'revealed_at', 'leaderboard'],
    leader: ['rank', 'display_name', 'value', 'distance'],
    error: ['error'],
    error_detail: ['code', 'message'],
  },
};

export function contractDigests(routes: readonly { method: string; path: string; versions: readonly Version[] }[]): Record<Version, string> {
  const digest = (version: Version): string => {
    const lines = [
      ...Object.entries(OBJECTS[version]).map(([name, keys]) => `object ${name} ${keys.join(',')}`),
      ...routes.filter((route) => route.versions.includes(version)).map((route) => `route ${route.method} ${route.path}`),
    ];
    const manifest = lines.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).join('\n') + '\n';
    return createHash('sha256').update(manifest, 'utf8').digest('hex');
  };
  return { v1: digest('v1'), v2: digest('v2') };
}
