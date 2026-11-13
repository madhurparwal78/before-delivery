import { Tx, BookingRow, DoorLogRow } from '../store.js';
import { DoorClearance } from './occupancy.js';

// Door actions each entry publishes, decided by the same rules the routes apply.
export function doorActions(b: BookingRow, now: number, clearance: DoorClearance): Array<'check_in' | 'check_out' | 'no_show'> {
  const actions: Array<'check_in' | 'check_out' | 'no_show'> = [];
  if (b.status === 'confirmed') {
    const opensAt = b.start - 30 * 60_000;
    if (now >= opensAt && now < b.end && clearance.cleared) actions.push('check_in');
    if (now >= b.start) actions.push('no_show');
  } else if (b.status === 'checked_in') {
    actions.push('check_out');
  }
  return actions;
}

export async function appendDoorLog(tx: Tx, bookingId: string, action: 'check_in' | 'check_out' | 'no_show', at: number, by: string): Promise<void> {
  await tx.query(
    `INSERT INTO door_log (booking_id, action, at, staff_by) VALUES ($1,$2,$3,$4)`,
    [bookingId, action, at, by],
  );
}

export async function doorLogFor(tx: Tx, bookingId: string): Promise<DoorLogRow[]> {
  const r = await tx.query<DoorLogRow>(
    `SELECT action, at, staff_by AS by FROM door_log WHERE booking_id=$1 ORDER BY id`,
    [bookingId],
  );
  return r.rows;
}
