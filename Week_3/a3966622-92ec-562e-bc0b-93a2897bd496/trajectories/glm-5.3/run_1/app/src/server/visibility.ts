// Visibility decides every read of a record. A record outside it answers 404.

import type { Store } from './store.js';
import type { Invoice, LadderReport, Move, User } from './types.js';

export function moveVisibleTo(store: Store, user: User, move: Move): boolean {
  if (user.role === 'dispatcher' || user.role === 'clerk') return true;
  if (user.role === 'agent') return move.agency_code === user.agency_code;
  if (user.role === 'pilot') {
    // Access survives a release, a refusal, a re-order or completion.
    return (
      move.pilot_id === user.id ||
      store.moves.some((m) => m.ref === move.ref && m.pilot_id === user.id)
    );
  }
  return false;
}

export function reportVisibleTo(store: Store, user: User, report: LadderReport): boolean {
  const move = store.moves.find((m) => m.ref === report.move_ref);
  if (!move) return false;
  return moveVisibleTo(store, user, move);
}

export function invoiceVisibleTo(user: User, invoice: Invoice): boolean {
  if (user.role === 'clerk') return true;
  if (user.role === 'agent') return invoice.agency_code === user.agency_code;
  return false;
}

export function vesselVisibleTo(user: User, agencyCode: string): boolean {
  if (user.role === 'dispatcher' || user.role === 'pilot') return true;
  if (user.role === 'agent') return agencyCode === user.agency_code;
  return false;
}
