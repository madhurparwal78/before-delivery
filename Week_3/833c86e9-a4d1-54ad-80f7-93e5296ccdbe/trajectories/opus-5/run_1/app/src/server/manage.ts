import { query, withTx } from './db';
import { ApiError, conflict, validation } from './errors';
import { broadcast } from './events';
import { markQuotesStale } from './sweep';
import { addDays, datesBetween, isDate, isoWeekday } from './zone';

export interface CalendarCell {
  room_type: string;
  date: string;
  rate_minor: number;
  allotment: number;
  left: number;
  min_stay: number;
  max_stay: number;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
  release_days: number;
}

export async function calendar(
  property: string,
  from: string,
  days: number,
): Promise<{ room_types: { code: string; name: string }[]; cells: CalendarCell[] }> {
  const roomTypes = await query<{ code: string; name: string }>(
    'select code, name from room_types where property = $1 order by code',
    [property],
  );
  const to = addDays(from, days - 1);
  const codes = roomTypes.map((t) => t.code);
  const cells = codes.length
    ? await query<CalendarCell>(
        `select n.room_type, to_char(n.date, 'YYYY-MM-DD') as date, n.base_rate_minor as rate_minor,
           n.allotment, n.min_stay, n.max_stay, n.closed_to_arrival, n.closed_to_departure,
           n.stop_sell, n.release_days,
           greatest(0, n.allotment - coalesce((
             select count(*) from claims c where c.active and c.room_type = n.room_type and c.date = n.date
           ), 0)) as left
         from nights n
         where n.room_type = any($1) and n.date >= $2 and n.date <= $3
         order by n.room_type, n.date`,
        [codes, from, to],
      )
    : [];
  return { room_types: roomTypes, cells };
}

export interface NightsPatch {
  room_types: string[];
  from: string;
  to: string;
  weekdays: number[];
  rate_minor?: number;
  rooms?: number;
  min_stay?: number;
  max_stay?: number;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
  stop_sell?: boolean;
  season_name?: string;
  replace?: string;
}

interface SeasonRow {
  id: string;
  name: string;
  room_types: string[];
  from_date: string;
  to_date: string;
  weekdays: number[];
}

function nightsOfPatch(patch: NightsPatch): string[] {
  return datesBetween(patch.from, addDays(patch.to, 1)).filter((date) => patch.weekdays.includes(isoWeekday(date)));
}

/** A manager's edit of the selected room types and nights on the ticked weekdays. */
export async function patchNights(
  property: string,
  patch: NightsPatch,
): Promise<{ changed_nights: number; season: { name: string } | null }> {
  const fields: Record<string, string> = {};
  if (!Array.isArray(patch.room_types) || patch.room_types.length === 0) fields.room_types = 'required';
  if (!isDate(patch.from)) fields.from = 'invalid';
  if (!isDate(patch.to)) fields.to = 'invalid';
  if (!Array.isArray(patch.weekdays) || patch.weekdays.length === 0) fields.weekdays = 'required';
  if (Object.keys(fields).length > 0) throw validation(fields);

  const owned = await query<{ code: string }>('select code from room_types where property = $1 and code = any($2)', [
    property,
    patch.room_types,
  ]);
  if (owned.length !== patch.room_types.length) throw validation({ room_types: 'invalid' });

  if (patch.rate_minor !== undefined && patch.rate_minor < 100) throw validation({ rate_minor: 'edit.rate_min' });
  if (patch.min_stay !== undefined && patch.min_stay < 1) throw validation({ min_stay: 'out_of_range' });
  if (patch.max_stay !== undefined && patch.max_stay < 1) throw validation({ max_stay: 'out_of_range' });
  if (patch.min_stay !== undefined && patch.max_stay !== undefined && patch.max_stay < patch.min_stay) {
    throw validation({ max_stay: 'edit.max_below_min' });
  }

  const dates = nightsOfPatch(patch);
  if (dates.length === 0) return { changed_nights: 0, season: null };

  if (patch.max_stay !== undefined && patch.min_stay === undefined) {
    const rows = await query<{ n: number }>(
      `select max(min_stay) as n from nights where room_type = any($1) and date = any($2::date[])`,
      [patch.room_types, dates],
    );
    if ((rows[0]?.n ?? 1) > patch.max_stay) throw validation({ max_stay: 'edit.max_below_min' });
  }
  if (patch.min_stay !== undefined && patch.max_stay === undefined) {
    const rows = await query<{ n: number }>(
      `select min(max_stay) as n from nights where room_type = any($1) and date = any($2::date[])`,
      [patch.room_types, dates],
    );
    if ((rows[0]?.n ?? 30) < patch.min_stay) throw validation({ max_stay: 'edit.max_below_min' });
  }

  if (patch.rooms !== undefined) {
    const rows = await query<{ n: string }>(
      `select coalesce(max(used), 0) as n from (
         select count(*) as used from claims
         where active and room_type = any($1) and date = any($2::date[])
         group by room_type, date
       ) as counts`,
      [patch.room_types, dates],
    );
    const sold = Number(rows[0]?.n ?? 0);
    if (patch.rooms < sold) {
      throw new ApiError(422, { error: 'validation', fields: { rooms: 'edit.rooms_sold' }, n: sold });
    }
  }

  const isSeason = dates.length > 1;
  if (isSeason && (!patch.season_name || patch.season_name.trim() === '')) {
    throw validation({ season_name: 'edit.season_name' });
  }

  if (isSeason) {
    const seasons = await query<SeasonRow>(
      `select id, name, room_types, to_char(from_date, 'YYYY-MM-DD') as from_date,
         to_char(to_date, 'YYYY-MM-DD') as to_date, weekdays
       from seasons where property = $1 order by name`,
      [property],
    );
    const nights = new Set(dates);
    const clashes = seasons
      .filter((season) => season.name !== patch.season_name)
      .map((season) => {
        const shared = datesBetween(season.from_date, addDays(season.to_date, 1))
          .filter((date) => season.weekdays.includes(isoWeekday(date)))
          .filter((date) => nights.has(date));
        const sharesRoom = season.room_types.some((code) => patch.room_types.includes(code));
        return { season, shared: sharesRoom ? shared : [] };
      })
      .filter((entry) => entry.shared.length > 0);
    const clash = clashes[0];
    if (clash && patch.replace !== clash.season.name) {
      throw conflict('season_overlap', {
        season: patch.season_name,
        other: clash.season.name,
        from: clash.shared[0],
        to: clash.shared[clash.shared.length - 1],
      });
    }
    if (clash && patch.replace === clash.season.name) {
      await query('delete from seasons where id = $1', [clash.season.id]);
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [patch.room_types, dates];
  const push = (column: string, value: unknown): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.rate_minor !== undefined) push('base_rate_minor', patch.rate_minor);
  if (patch.rooms !== undefined) push('allotment', patch.rooms);
  if (patch.min_stay !== undefined) push('min_stay', patch.min_stay);
  if (patch.max_stay !== undefined) push('max_stay', patch.max_stay);
  if (patch.closed_to_arrival !== undefined) push('closed_to_arrival', patch.closed_to_arrival);
  if (patch.closed_to_departure !== undefined) push('closed_to_departure', patch.closed_to_departure);
  if (patch.stop_sell !== undefined) push('stop_sell', patch.stop_sell);

  let changed = 0;
  await withTx(async (client) => {
    if (sets.length > 0) {
      const result = await client.query(
        `update nights set ${sets.join(', ')} where room_type = any($1) and date = any($2::date[])`,
        params,
      );
      changed = result.rowCount ?? 0;
    }
    if (isSeason && patch.season_name) {
      await client.query(
        `insert into seasons (property, name, room_types, from_date, to_date, weekdays)
         values ($1,$2,$3,$4,$5,$6)`,
        [property, patch.season_name, patch.room_types, patch.from, patch.to, patch.weekdays],
      );
    }
  });

  broadcast('availability', { property, room_type: patch.room_types[0], dates });
  await markQuotesStale(property, dates);
  return { changed_nights: changed, season: isSeason && patch.season_name ? { name: patch.season_name } : null };
}
