import type { BookingState, Role } from '../shared/types.js';
import { forbidden, invalidTransition } from '../server/errors.js';
import { effectiveState, type BookingRow } from './bookings.js';

export type TransitionName =
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
  const state = effectiveState(row);
  if (!RULES[name].from.includes(state)) throw invalidTransition(row.ref, state);
  return state;
}

export function assertTransition(
  name: TransitionName,
  row: BookingRow,
  role: Role,
): BookingState {
  assertTransitionRole(name, role);
  return assertTransitionState(name, row);
}
