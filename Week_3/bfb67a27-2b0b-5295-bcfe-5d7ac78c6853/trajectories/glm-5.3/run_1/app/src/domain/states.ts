// The one place booking state transitions and their rights are decided (DP-36).

import type { BookingState, RenterRole } from '../types.js';

export type TransitionName =
  | 'hold'
  | 'upload_certificate'
  | 'confirm'
  | 'cancel'
  | 'swap'
  | 'prep'
  | 'checkout_photo'
  | 'checkout'
  | 'checkin_photo'
  | 'checkin_unit'
  | 'close';

interface TransitionRule {
  from: ReadonlySet<BookingState>;
  who: ReadonlySet<RenterRole>;
}

const TRANSITIONS: Readonly<Record<TransitionName, TransitionRule>> = {
  hold: { from: new Set(), who: new Set(['renter', 'owner', 'prep_tech']) },
  upload_certificate: {
    from: new Set(['quote', 'confirmed', 'prepped']),
    who: new Set(['renter', 'owner']),
  },
  confirm: { from: new Set(['quote']), who: new Set(['renter', 'owner']) },
  cancel: { from: new Set(['confirmed']), who: new Set(['renter', 'owner']) },
  swap: { from: new Set(['quote', 'confirmed']), who: new Set(['owner', 'prep_tech']) },
  prep: { from: new Set(['confirmed']), who: new Set(['owner', 'prep_tech']) },
  checkout_photo: { from: new Set(['prepped']), who: new Set(['owner', 'prep_tech']) },
  checkout: { from: new Set(['prepped']), who: new Set(['owner', 'prep_tech']) },
  checkin_photo: { from: new Set(['out', 'returned']), who: new Set(['owner', 'prep_tech']) },
  checkin_unit: { from: new Set(['out']), who: new Set(['owner', 'prep_tech']) },
  close: { from: new Set(['returned']), who: new Set(['owner', 'prep_tech']) },
};

export function transitionAllowed(transition: TransitionName, state: BookingState, role: RenterRole): boolean {
  const rule = TRANSITIONS[transition];
  return rule.from.has(state) && rule.who.has(role);
}

export function stateMessage(ref: string, state: BookingState): string {
  return `Booking ${ref} is ${state}`;
}
