import { Db, rows } from '../db';
import { dateRange, daysBetween, PlainDate } from '../../shared/dates';
import { Figures, figuresFrom } from '../domain/reports';

export interface NightlyFigures extends Figures {
  date: PlainDate;
}

interface NightRow {
  date: string;
  rooms_available: number;
  rooms_sold: number;
  room_revenue_cents: number;
}

/**
 * Room counts and revenue for each night of the range. A closed night keeps the rooms-available
 * count fixed at its close; an open night counts rooms out of order now.
 */
async function nightRows(
  db: Db,
  hotelId: string,
  from: PlainDate,
  to: PlainDate,
): Promise<NightRow[]> {
  return rows<NightRow>(
    db,
    `with nights as (
        select generate_series($2::date, $3::date, interval '1 day')::date as date
      ),
      open_available as (
        select count(*)::int as count from rooms
         where hotel_id = $1 and status <> 'out_of_order'
      )
      select n.date,
             coalesce(c.rooms_available, (select count from open_available)) as rooms_available,
             coalesce(sold.count, 0) as rooms_sold,
             coalesce(sold.revenue, 0) as room_revenue_cents
        from nights n
        left join closed_days c on c.hotel_id = $1 and c.date = n.date
        left join lateral (
          select count(*)::int as count, coalesce(sum(sn.room_cents), 0)::bigint as revenue
            from stay_segments sg
            join stays s on s.id = sg.stay_id
            join stay_nights sn on sn.stay_id = s.id and sn.date = n.date
           where s.hotel_id = $1
             and s.status in ('booked','in_house','checked_out')
             and sg.first_night <= n.date
             and n.date < sg.first_night + sg.nights
        ) sold on true
       order by n.date`,
    [hotelId, from, to],
  );
}

export interface RangeReport extends Figures {
  from: PlainDate;
  to: PlainDate;
  nights: NightlyFigures[];
}

export async function rangeReport(
  db: Db,
  hotelId: string,
  from: PlainDate,
  to: PlainDate,
): Promise<RangeReport> {
  const nights = await nightRows(db, hotelId, from, to);
  const nightly = nights.map((row) => ({
    date: row.date,
    ...figuresFrom(row.rooms_available, row.rooms_sold, Number(row.room_revenue_cents)),
  }));
  const totals = nights.reduce(
    (sum, row) => ({
      available: sum.available + row.rooms_available,
      sold: sum.sold + row.rooms_sold,
      revenue: sum.revenue + Number(row.room_revenue_cents),
    }),
    { available: 0, sold: 0, revenue: 0 },
  );
  return {
    from,
    to,
    ...figuresFrom(totals.available, totals.sold, totals.revenue),
    nights: nightly,
  };
}

export interface NightTally {
  roomsAvailable: number;
  roomsSold: number;
  roomRevenueCents: number;
}

export async function nightTally(db: Db, hotelId: string, date: PlainDate): Promise<NightTally> {
  const found = await nightRows(db, hotelId, date, date);
  const row = found[0];
  return {
    roomsAvailable: row ? row.rooms_available : 0,
    roomsSold: row ? row.rooms_sold : 0,
    roomRevenueCents: row ? Number(row.room_revenue_cents) : 0,
  };
}

export const MAX_REPORT_NIGHTS = 366;
export const MAX_TIMELINE_NIGHTS = 62;

export function rangeNightCount(from: PlainDate, to: PlainDate): number {
  return daysBetween(from, to) + 1;
}

export function nightsOfRange(from: PlainDate, to: PlainDate): PlainDate[] {
  return dateRange(from, rangeNightCount(from, to));
}
