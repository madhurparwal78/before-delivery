import { query } from '../db.js';
import { officeLocalToInstant } from '../officeTime.js';
import type { PersonRow, PersonStatus } from '../types.js';

export type TravelRow = {
  id: string;
  person_id: string;
  starts_local: string;
  ends_local: string;
  starts_at: Date;
  ends_at: Date;
};

export async function loadPeople(): Promise<PersonRow[]> {
  return query<PersonRow>('select * from people order by order_no asc');
}

export async function loadPerson(id: string): Promise<PersonRow | null> {
  const rows = await query<PersonRow>('select * from people where id = $1', [id]);
  return rows[0] ?? null;
}

export async function loadPersonByHandle(handle: string): Promise<PersonRow | null> {
  const rows = await query<PersonRow>('select * from people where handle = $1', [handle]);
  return rows[0] ?? null;
}

export async function scopeIds(personId: string): Promise<string[]> {
  const rows = await query<{ vault_id: string; drawer_order: number }>(
    `select pv.vault_id, v.drawer_order from person_vaults pv
       join vaults v on v.id = pv.vault_id
      where pv.person_id = $1
      order by v.drawer_order asc`,
    [personId],
  );
  return rows.map((row) => row.vault_id);
}

export async function travelWindows(personId: string): Promise<TravelRow[]> {
  return query<TravelRow>('select * from travel_windows where person_id = $1 order by starts_at desc', [personId]);
}

export function travelOpenAt(windows: readonly TravelRow[], at: Date): boolean {
  return windows.some((window) => at.getTime() >= window.starts_at.getTime() && at.getTime() < window.ends_at.getTime());
}

export function termStartsAt(person: PersonRow): Date | null {
  const starts = person.term_starts_on;
  return starts === null ? null : officeLocalToInstant(starts, '00:00').at;
}

/** Scopes end at 23:59 office time on the last day of the term. */
export function termEndsAt(person: PersonRow): Date | null {
  const ends = person.term_ends_on;
  return ends === null ? null : officeLocalToInstant(ends, '23:59').at;
}

export function termRunningAt(person: PersonRow, at: Date): boolean {
  const starts = termStartsAt(person);
  const ends = termEndsAt(person);
  if (starts === null || ends === null) return false;
  return at.getTime() >= starts.getTime() && at.getTime() < ends.getTime();
}

export function personStatus(person: PersonRow, windows: readonly TravelRow[], at: Date): PersonStatus {
  if (person.left_at !== null) return 'left';
  if (travelOpenAt(windows, at)) return 'travelling';
  if (person.role === 'outside_bookkeeper' && termRunningAt(person, at)) return 'on_term';
  if (!person.has_signed_in) return 'invited';
  return 'active';
}

export function personJson(
  person: PersonRow,
  vaultIds: readonly string[],
  windows: readonly TravelRow[],
  at: Date,
): Record<string, unknown> {
  const startsOn = person.term_starts_on;
  const endsOn = person.term_ends_on;
  return {
    id: person.id,
    full_name: person.full_name,
    email: person.email,
    handle: person.handle,
    role: person.role,
    aliases: person.aliases,
    status: personStatus(person, windows, at),
    vault_ids: [...vaultIds],
    term: startsOn === null || endsOn === null ? null : { starts_on: startsOn, ends_on: endsOn },
    travel: windows.map((window) => ({ id: window.id, starts_at: window.starts_local, ends_at: window.ends_local })),
    seat: person.seat,
    left_at: person.left_at === null ? null : person.left_at.toISOString(),
  };
}

export async function deskStaffIds(): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `select id from people
      where left_at is null and role in ('office_manager','managing_partner')
      order by order_no asc`,
  );
  return rows.map((row) => row.id);
}
