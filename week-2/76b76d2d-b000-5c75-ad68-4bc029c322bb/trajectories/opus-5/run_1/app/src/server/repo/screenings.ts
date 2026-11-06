import type { Locale } from '../../shared/money.ts';
import type { SeasonState } from '../../shared/domain.ts';
import { query, one, type Tx } from '../db/pool.ts';
import { derivedState, priorityOpensAt, publicOpensAt, PUBLIC_STAGE_STATES, type StoredSeasonState } from '../domain/seasons.ts';
import { toIso, torontoDate, torontoLocal } from '../domain/time.ts';

export type SeasonRow = {
  slug: string;
  title_en: string;
  title_fr: string;
  public_sale_date: string;
  stored_state: StoredSeasonState;
};

export type ScreeningRow = {
  id: string;
  season_slug: string;
  film_title: string;
  film_notes_en: string;
  film_notes_fr: string;
  format: string;
  auditorium_code: string;
  starts_at: Date;
  auditorium_name: string;
  venue_name: string;
  venue_address: string;
  row_letters: string;
  seats_per_row: number;
  capacity: number;
};

const SCREENING_SELECT = `
  select s.id, s.season_slug, s.film_title, s.film_notes_en, s.film_notes_fr, s.format,
         s.auditorium_code, s.starts_at,
         a.name as auditorium_name, a.row_letters, a.seats_per_row, a.capacity,
         v.name as venue_name, v.address as venue_address
    from screenings s
    join auditoriums a on a.code = s.auditorium_code
    join venues v on v.id = a.venue_id`;

export function seatCodes(rowLetters: string, seatsPerRow: number): string[] {
  const seats: string[] = [];
  for (const letter of rowLetters) {
    for (let number = 1; number <= seatsPerRow; number += 1) seats.push(`${letter}${number}`);
  }
  return seats;
}

export function seatRows(rowLetters: string, seatsPerRow: number): string[][] {
  return [...rowLetters].map((letter) =>
    Array.from({ length: seatsPerRow }, (_, index) => `${letter}${index + 1}`),
  );
}

export async function getScreening(id: string): Promise<ScreeningRow | null> {
  return one<ScreeningRow>(`${SCREENING_SELECT} where s.id = $1`, [id]);
}

export type ClaimRow = { seat: string; sold: boolean; hold_id: string | null; active: boolean };

export async function activeClaims(screeningId: string): Promise<ClaimRow[]> {
  return query<ClaimRow>(
    `select seat, sold, hold_id::text as hold_id, (sold or expires_at > now()) as active
       from seat_claims where screening_id = $1`,
    [screeningId],
  );
}

export type SeatState = 'available' | 'held' | 'sold' | 'mine';

export async function seatStates(
  screening: ScreeningRow,
  mineHoldIds: string[],
): Promise<Array<{ code: string; state: SeatState }>> {
  const claims = await activeClaims(screening.id);
  const byCode = new Map(claims.filter((claim) => claim.active).map((claim) => [claim.seat, claim]));
  const mine = new Set(mineHoldIds);
  return seatCodes(screening.row_letters, screening.seats_per_row).map((code) => {
    const claim = byCode.get(code);
    if (claim === undefined) return { code, state: 'available' as SeatState };
    if (claim.hold_id !== null && mine.has(claim.hold_id)) return { code, state: 'mine' as SeatState };
    return { code, state: claim.sold ? ('sold' as SeatState) : ('held' as SeatState) };
  });
}

export async function seatCounts(
  screeningId: string,
  capacity: number,
): Promise<{ sold: number; held: number; remaining: number }> {
  const row = await one<{ sold: number; held: number }>(
    `select
       coalesce(sum(case when sold then 1 else 0 end), 0)::int as sold,
       coalesce(sum(case when not sold and expires_at > now() then 1 else 0 end), 0)::int as held
       from seat_claims where screening_id = $1`,
    [screeningId],
  );
  const sold = row?.sold ?? 0;
  const held = row?.held ?? 0;
  return { sold, held, remaining: Math.max(0, capacity - sold - held) };
}

export async function seatsRemainingForMany(screeningIds: string[]): Promise<Map<string, number>> {
  if (screeningIds.length === 0) return new Map();
  const rows = await query<{ id: string; capacity: number; taken: number }>(
    `select s.id, a.capacity,
            coalesce((select count(*) from seat_claims c
                       where c.screening_id = s.id and (c.sold or c.expires_at > now())), 0)::int as taken
       from screenings s join auditoriums a on a.code = s.auditorium_code
      where s.id = any($1::text[])`,
    [screeningIds],
  );
  return new Map(rows.map((row) => [row.id, Math.max(0, row.capacity - row.taken)]));
}

export type SeasonSummary = {
  slug: string;
  title: string;
  title_en: string;
  title_fr: string;
  state: SeasonState;
  public_sale_date: string;
  priority_opens_at: string;
  public_opens_at: string;
  first_date: string | null;
  last_date: string | null;
  screening_count: number;
};

export async function seasonSummaries(locale: Locale, now: Date): Promise<SeasonSummary[]> {
  const rows = await query<SeasonRow & { first_at: Date | null; last_at: Date | null; screening_count: number }>(
    `select se.slug, se.title_en, se.title_fr, se.public_sale_date, se.stored_state,
            min(sc.starts_at) as first_at, max(sc.starts_at) as last_at, count(sc.id)::int as screening_count
       from seasons se left join screenings sc on sc.season_slug = se.slug
      group by se.slug, se.title_en, se.title_fr, se.public_sale_date, se.stored_state`,
  );
  return rows
    .map((row) => ({
      slug: row.slug,
      title: locale === 'fr' ? row.title_fr : row.title_en,
      title_en: row.title_en,
      title_fr: row.title_fr,
      state: derivedState(row.stored_state, row.public_sale_date, now),
      public_sale_date: row.public_sale_date,
      priority_opens_at: toIso(priorityOpensAt(row.public_sale_date)),
      public_opens_at: toIso(publicOpensAt(row.public_sale_date)),
      first_date: row.first_at === null ? null : torontoDate(row.first_at),
      last_date: row.last_at === null ? null : torontoDate(row.last_at),
      screening_count: row.screening_count,
      sort_key: row.first_at === null ? Number.MAX_SAFE_INTEGER : row.first_at.getTime(),
    }))
    .sort((a, b) => a.sort_key - b.sort_key || (a.slug < b.slug ? -1 : 1))
    .map(({ sort_key: _sortKey, ...season }) => season);
}

export async function stageSeasons(locale: Locale, now: Date): Promise<SeasonSummary[]> {
  const seasons = await seasonSummaries(locale, now);
  return seasons.filter((season) => PUBLIC_STAGE_STATES.includes(season.state));
}

export type ScreeningSummary = {
  id: string;
  film_title: string;
  format: string;
  auditorium: string;
  starts_at: string;
  starts_local: string;
  capacity: number;
  seats_remaining: number;
};

export async function seasonScreenings(
  slug: string,
  options: { futureOnly: boolean; now: Date },
): Promise<ScreeningSummary[]> {
  const rows = await query<ScreeningRow>(
    `${SCREENING_SELECT} where s.season_slug = $1 order by s.starts_at asc, s.sequence asc`,
    [slug],
  );
  const filtered = options.futureOnly
    ? rows.filter((row) => row.starts_at.getTime() >= options.now.getTime())
    : rows;
  const remaining = await seatsRemainingForMany(filtered.map((row) => row.id));
  return filtered.map((row) => ({
    id: row.id,
    film_title: row.film_title,
    format: row.format,
    auditorium: row.auditorium_code,
    starts_at: toIso(row.starts_at),
    starts_local: torontoLocal(row.starts_at),
    capacity: row.capacity,
    seats_remaining: remaining.get(row.id) ?? row.capacity,
  }));
}

export async function nextSequence(tx: Tx, slug: string): Promise<number> {
  const row = await tx.one<{ next: number }>(
    'select coalesce(max(sequence), 0) + 1 as next from screenings where season_slug = $1',
    [slug],
  );
  return row?.next ?? 1;
}

export async function getSeason(slug: string): Promise<SeasonRow | null> {
  return one<SeasonRow>(
    'select slug, title_en, title_fr, public_sale_date, stored_state from seasons where slug = $1',
    [slug],
  );
}
