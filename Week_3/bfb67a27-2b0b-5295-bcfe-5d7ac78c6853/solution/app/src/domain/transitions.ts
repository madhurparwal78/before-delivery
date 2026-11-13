import { withTransaction } from '../server/db.js';
import type { BookingState, Role } from '../shared/types.js';
import { forbidden, invalidTransition } from '../server/errors.js';
import { effectiveState, findBookingRow, type BookingRow } from './bookings.js';

type TransitionName =
  | 'expire'
  | 'upload_certificate'
  | 'confirm'
  | 'cancel'
  | 'swap'
  | 'prep'
  | 'checkout_photo'
  | 'checkout'
  | 'checkin_photo'
  | 'checkin'
  | 'close';

interface TransitionRule {
  from: BookingState[];
  roles: Role[];
}

/** The published From states and roles for every booking transition. */
const RULES: Record<TransitionName, TransitionRule> = {
  expire: { from: ['quote'], roles: [] },
  upload_certificate: { from: ['quote', 'confirmed', 'prepped'], roles: ['renter', 'owner'] },
  confirm: { from: ['quote'], roles: ['renter', 'owner'] },
  cancel: { from: ['confirmed'], roles: ['renter', 'owner'] },
  swap: { from: ['quote', 'confirmed'], roles: ['owner', 'prep_tech'] },
  prep: { from: ['confirmed'], roles: ['owner', 'prep_tech'] },
  checkout_photo: { from: ['prepped'], roles: ['owner', 'prep_tech'] },
  checkout: { from: ['prepped'], roles: ['owner', 'prep_tech'] },
  checkin_photo: { from: ['out', 'returned'], roles: ['owner', 'prep_tech'] },
  checkin: { from: ['out'], roles: ['owner', 'prep_tech'] },
  close: { from: ['returned'], roles: ['owner', 'prep_tech'] },
};

/** The role's right to a transition, which outranks any state conflict. */
export function assertTransitionRole(name: TransitionName, role: Role): void {
  if (!RULES[name].roles.includes(role)) throw forbidden();
}

/** The booking's current state against the transition's published From states. */
export function assertTransitionState(name: TransitionName, row: BookingRow): BookingState {
  const state = name === 'expire' ? row.storedState : effectiveState(row);
  if (!RULES[name].from.includes(state)) throw invalidTransition(row.ref, state);
  return state;
}

/** A multipart phase is validated after any unavoidable state conflict. */
export function assertAnyTransitionState(names: TransitionName[], row: BookingRow): void {
  const state = effectiveState(row);
  if (!names.some(name => RULES[name].from.includes(state))) throw invalidTransition(row.ref, state);
}

export function assertTransition(
  name: TransitionName,
  row: BookingRow,
  role: Role,
): BookingState {
  assertTransitionRole(name, role);
  return assertTransitionState(name, row);
}

/** Persist due holds using the same transition rules as request handlers. */
export async function expireDueQuotes(): Promise<void> {
  await withTransaction(async (client) => {
    const due = await client.query<{ ref: string }>(
      `SELECT ref FROM bookings WHERE state = 'quote' AND hold_expires_at <= clock_timestamp()
       FOR UPDATE SKIP LOCKED`,
    );
    for (const { ref } of due.rows) {
      const row = await findBookingRow(client, ref);
      if (row === null) continue;
      assertTransitionState('expire', row);
      await client.query(`UPDATE bookings SET state = 'expired' WHERE ref = $1`, [ref]);
    }
  });
}
