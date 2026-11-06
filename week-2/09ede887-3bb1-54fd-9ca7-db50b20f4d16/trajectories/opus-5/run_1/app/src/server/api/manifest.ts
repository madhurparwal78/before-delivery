import { createHash } from 'node:crypto';

/** The published key order of every object in each version. */
export const V1_OBJECTS: Readonly<Record<string, readonly string[]>> = {
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
    'id', 'day', 'date', 'starts_at', 'ends_at', 'starts_at_utc', 'ends_at_utc', 'title', 'speakers', 'stage',
    'stage_name', 'location', 'format', 'format_label', 'description', 'capacity', 'seats_left', 'waitlist_count',
    'reserved_by_me', 'saved_by_me', 'waitlist_position',
  ],
  signed_out: ['signed_out'],
  speaker: ['name', 'company', 'sessions'],
  speaker_ref: ['name', 'company'],
  stage: ['slug', 'name', 'description'],
  waitlist: ['session_id', 'position', 'created_at'],
  waitlist_joined: ['waitlist'],
  waitlist_left: ['waitlisted'],
};

export const V2_OBJECTS: Readonly<Record<string, readonly string[]>> = {
  account: ['id', 'name', 'email', 'role'],
  auth: ['token', 'account'],
  cancelled: ['seats'],
  error: ['error'],
  error_detail: ['code', 'message'],
  guess: ['value', 'created_at'],
  guess_created: ['guess'],
  hold: ['session_id', 'held_until', 'seconds_remaining'],
  leader: ['rank', 'display_name', 'value', 'distance'],
  my_agenda: ['reserved', 'held', 'waitlisted', 'saved'],
  organiser_row: ['id', 'title', 'day', 'start_local', 'end_local', 'seats', 'waitlisted'],
  record: ['status', 'closes_at', 'guess_count', 'my_guess', 'final_figure', 'revealed_at', 'leaderboard'],
  released: ['held'],
  reservation: ['id', 'session_id', 'created_at'],
  reservation_created: ['reservation', 'seats'],
  reveal: ['status', 'final_figure', 'revealed_at', 'leaderboard'],
  roster_row: ['name', 'email', 'reserved_at'],
  saved: ['saved'],
  seats: ['capacity', 'reserved', 'held', 'left'],
  session: [
    'id', 'day', 'date', 'start_local', 'end_local', 'start_instant', 'end_instant', 'title', 'speakers', 'stage',
    'stage_name', 'location', 'format', 'format_label', 'description', 'seats', 'waitlist_count', 'reserved_by_me',
    'saved_by_me', 'waitlist_position', 'my_hold',
  ],
  signed_out: ['signed_out'],
  speaker: ['slug', 'name', 'company', 'sessions', 'bio', 'bio_html'],
  speaker_ref: ['name', 'company'],
  stage: ['slug', 'name', 'description'],
  waitlist: ['session_id', 'position', 'created_at'],
  waitlist_joined: ['waitlist'],
  waitlist_left: ['waitlisted'],
};

export function buildManifest(
  objects: Readonly<Record<string, readonly string[]>>,
  routes: readonly { readonly method: string; readonly path: string }[],
): string {
  const lines = [
    ...Object.entries(objects).map(([name, keys]) => `object ${name} ${keys.join(',')}`),
    ...routes.map((route) => `route ${route.method} ${route.path}`),
  ];
  lines.sort(compareByBytes);
  return `${lines.join('\n')}\n`;
}

function compareByBytes(left: string, right: string): number {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return Buffer.compare(a, b);
}

export function digestOf(manifest: string): string {
  return createHash('sha256').update(Buffer.from(manifest, 'utf8')).digest('hex');
}
