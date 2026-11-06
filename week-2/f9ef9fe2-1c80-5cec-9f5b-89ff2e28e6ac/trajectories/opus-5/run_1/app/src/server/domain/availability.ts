import { query, type Sql } from '../db/pool.js';
import { liveHoldSql } from './holds.js';

export const ACTIVE_BOOKING_STATES = ['confirmed', 'checked_in', 'completed', 'no_show'] as const;

export interface OccupiedCell {
  station_id: string;
  start_minute: number;
  kind: 'hold' | 'booking';
  member_id: string;
  business: string;
  hold_id: string | null;
  booking_id: string | null;
  expires_at: Date | null;
}

/** Every cell of a kitchen day that a live hold or an active booking covers. */
export async function occupiedCells(
  client: Sql,
  kitchenId: string,
  date: string,
  now: Date,
): Promise<OccupiedCell[]> {
  return query<OccupiedCell>(
    client,
    `SELECT hc.station_id, hc.start_minute, 'hold' AS kind, h.member_id, m.business,
            h.id AS hold_id, NULL::text AS booking_id, h.expires_at
       FROM hold_cells hc
       JOIN holds h ON h.id = hc.hold_id
       JOIN members m ON m.id = h.member_id
      WHERE h.kitchen_id = $1 AND h.date = $2 AND ${liveHoldSql('h', '$3')}
     UNION ALL
     SELECT bc.station_id, bc.start_minute, 'booking' AS kind, b.member_id, m.business,
            NULL::text AS hold_id, b.id AS booking_id, NULL::timestamptz AS expires_at
       FROM booking_cells bc
       JOIN bookings b ON b.id = bc.booking_id
       JOIN members m ON m.id = b.member_id
      WHERE b.kitchen_id = $1 AND b.date = $2
        AND b.state = ANY($4::text[])`,
    [kitchenId, date, now, [...ACTIVE_BOOKING_STATES]],
  );
}

export function occupancyKeys(cells: readonly OccupiedCell[]): Set<string> {
  return new Set(cells.map((cell) => `${cell.station_id}@${cell.start_minute}`));
}

export function cellKey(stationId: string, startMinute: number): string {
  return `${stationId}@${startMinute}`;
}
