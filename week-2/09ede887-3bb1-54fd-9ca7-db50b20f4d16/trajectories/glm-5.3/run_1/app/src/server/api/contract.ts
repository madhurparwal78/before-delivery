/**
 * The contract manifests. Each manifest is built from the version's object key
 * definitions and published route table, and its SHA-256 digest is served by
 * GET /api/_contract.
 */

import { createHash } from 'node:crypto';

/** Every published object, with its keys in order. */
export const V1_OBJECTS: Record<string, string[]> = {
  account: ['id', 'name', 'email', 'role'],
  auth: ['token', 'account'],
  cancelled: ['seats_left'],
  error: ['error', 'message'],
  guess: ['value', 'created_at'],
  guess_created: ['guess'],
  leader: ['rank', 'display_name', 'value', 'distance'],
  my_agenda: ['reserved', 'waitlisted', 'saved'],
  organiser_row: ['id', 'title', 'day', 'starts_at', 'ends_at', 'capacity', 'reserved', 'seats_left', 'waitlisted'],
  record: ['status', 'closes_at', 'guess_count', 'my_guess', 'final_figure', 'revealed_at', 'leaderboard'],
  reservation: ['id', 'session_id', 'created_at'],
  reservation_created: ['reservation', 'seats_left'],
  reveal: ['status', 'final_figure', 'revealed_at', 'leaderboard'],
  roster_row: ['name', 'email', 'reserved_at'],
  saved: ['saved'],
  session: [
    'id', 'day', 'date', 'starts_at', 'ends_at', 'starts_at_utc', 'ends_at_utc',
    'title', 'speakers', 'stage', 'stage_name', 'location', 'format', 'format_label',
    'description', 'capacity', 'seats_left', 'waitlist_count', 'reserved_by_me',
    'saved_by_me', 'waitlist_position',
  ],
  signed_out: ['signed_out'],
  speaker: ['name', 'company', 'sessions'],
  speaker_ref: ['name', 'company'],
  stage: ['slug', 'name', 'description'],
  waitlist: ['session_id', 'position', 'created_at'],
  waitlist_joined: ['waitlist'],
  waitlist_left: ['waitlisted'],
};

export const V2_OBJECTS: Record<string, string[]> = {
  ...V1_OBJECTS,
  cancelled: ['seats'],
  error: ['error'],
  error_detail: ['code', 'message'],
  hold: ['session_id', 'held_until', 'seconds_remaining'],
  my_agenda: ['reserved', 'held', 'waitlisted', 'saved'],
  organiser_row: ['id', 'title', 'day', 'start_local', 'end_local', 'seats', 'waitlisted'],
  released: ['held'],
  reservation_created: ['reservation', 'seats'],
  seats: ['capacity', 'reserved', 'held', 'left'],
  session: [
    'id', 'day', 'date', 'start_local', 'end_local', 'start_instant', 'end_instant',
    'title', 'speakers', 'stage', 'stage_name', 'location', 'format', 'format_label',
    'description', 'seats', 'waitlist_count', 'reserved_by_me', 'saved_by_me',
    'waitlist_position', 'my_hold',
  ],
  speaker: ['slug', 'name', 'company', 'sessions', 'bio', 'bio_html'],
};

export interface RouteDef {
  method: string;
  path: string;
}

/** The v1 published routes, relative to the version root. */
export const V1_ROUTES: RouteDef[] = [
  { method: 'DELETE', path: '/sessions/{id}/reservation' },
  { method: 'DELETE', path: '/sessions/{id}/save' },
  { method: 'DELETE', path: '/sessions/{id}/waitlist' },
  { method: 'GET', path: '/agenda.ics' },
  { method: 'GET', path: '/me' },
  { method: 'GET', path: '/me/agenda' },
  { method: 'GET', path: '/organiser/sessions' },
  { method: 'GET', path: '/organiser/sessions/{id}/roster' },
  { method: 'GET', path: '/organiser/sessions/{id}/roster.csv' },
  { method: 'GET', path: '/record' },
  { method: 'GET', path: '/sessions' },
  { method: 'GET', path: '/sessions/{id}' },
  { method: 'GET', path: '/speakers' },
  { method: 'GET', path: '/stages' },
  { method: 'PATCH', path: '/organiser/sessions/{id}' },
  { method: 'POST', path: '/auth/login' },
  { method: 'POST', path: '/auth/logout' },
  { method: 'POST', path: '/auth/signup' },
  { method: 'POST', path: '/organiser/record/reveal' },
  { method: 'POST', path: '/record/guesses' },
  { method: 'POST', path: '/sessions/{id}/reservation' },
  { method: 'POST', path: '/sessions/{id}/waitlist' },
  { method: 'PUT', path: '/sessions/{id}/save' },
];

/** The v2 published routes: v1's plus the v2-only ones. */
export const V2_ROUTES: RouteDef[] = [
  ...V1_ROUTES,
  { method: 'DELETE', path: '/sessions/{id}/hold' },
  { method: 'GET', path: '/me/holds' },
  { method: 'POST', path: '/sessions/{id}/claim' },
  { method: 'PUT', path: '/organiser/speakers/{slug}/bio' },
];

/** Build a manifest from object keys and routes, sorted by byte value. */
function manifest(objects: Record<string, string[]>, routes: RouteDef[]): string {
  const lines: string[] = [];
  for (const [name, keys] of Object.entries(objects)) {
    lines.push(`object ${name} ${keys.join(',')}`);
  }
  for (const r of routes) {
    lines.push(`route ${r.method} ${r.path}`);
  }
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return lines.join('\n') + '\n';
}

export function v1Manifest(): string {
  return manifest(V1_OBJECTS, V1_ROUTES);
}

export function v2Manifest(): string {
  return manifest(V2_OBJECTS, V2_ROUTES);
}

export function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
