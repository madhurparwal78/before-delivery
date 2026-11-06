/**
 * The paired hour ledger. Every change to a renter's hours passes through
 * `recordMovement`, which writes exactly one debit and one credit of the same
 * positive minutes. No balance is stored: both balances are sums of entries.
 */

import type { Db } from '../db.js';
import type { MovementKind } from '../../shared/types.js';

export const availableAccount = (renterId: string): string => `renter:${renterId}:available`;
export const heldAccount = (renterId: string): string => `renter:${renterId}:held`;

const KITCHEN_OPENING = 'kitchen:opening';
const KITCHEN_SOLD = 'kitchen:sold';
const KITCHEN_CONSUMED = 'kitchen:consumed';
const KITCHEN_FORFEITED = 'kitchen:forfeited';
const KITCHEN_ADJUSTMENTS = 'kitchen:adjustments';

export class InsufficientHours extends Error {
  constructor(
    readonly balanceMinutes: number,
    readonly neededMinutes: number,
  ) {
    super('insufficient_hours');
  }
}

/** The two accounts each movement moves minutes between. */
function accountsFor(
  kind: MovementKind,
  renterId: string,
  negativeAdjustment: boolean,
): { debit: string; credit: string } {
  const available = availableAccount(renterId);
  const held = heldAccount(renterId);
  switch (kind) {
    case 'opening_balance':
      return { debit: KITCHEN_OPENING, credit: available };
    case 'pack_purchase':
      return { debit: KITCHEN_SOLD, credit: available };
    case 'booking_hold':
      return { debit: available, credit: held };
    case 'hold_release':
    case 'cancellation_credit':
    case 'displacement_credit':
      return { debit: held, credit: available };
    case 'checkout':
      return { debit: held, credit: KITCHEN_CONSUMED };
    case 'cancellation_forfeit':
      return { debit: held, credit: KITCHEN_FORFEITED };
    case 'adjustment':
      return negativeAdjustment
        ? { debit: available, credit: KITCHEN_ADJUSTMENTS }
        : { debit: KITCHEN_ADJUSTMENTS, credit: available };
  }
}

async function accountBalance(tx: Db, account: string): Promise<number> {
  const row = await tx.one<{ balance: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN minutes ELSE -minutes END), 0)::text AS balance
       FROM ledger_entries WHERE account = $1`,
    [account],
  );
  return Number(row.balance);
}

export async function balanceMinutes(tx: Db, renterId: string): Promise<number> {
  return accountBalance(tx, availableAccount(renterId));
}

export async function heldMinutes(tx: Db, renterId: string): Promise<number> {
  return accountBalance(tx, heldAccount(renterId));
}

/** Takes the renter's hour lock, so concurrent movements cannot interleave. */
export async function lockRenterHours(tx: Db, renterId: string): Promise<void> {
  await tx.query('SELECT 1 FROM renters WHERE id = $1 FOR UPDATE', [renterId]);
}

export interface MovementInput {
  renterId: string;
  kind: MovementKind;
  /** Positive for every movement except a negative adjustment. */
  minutes: number;
  bookingId?: string | null;
  purchaseId?: string | null;
  note?: string | null;
}

/**
 * Writes one movement as two equal and opposite entries. The caller must
 * already hold the renter's hour lock.
 */
export async function recordMovement(tx: Db, input: MovementInput): Promise<string> {
  const negativeAdjustment = input.kind === 'adjustment' && input.minutes < 0;
  const minutes = Math.abs(input.minutes);
  const { debit, credit } = accountsFor(input.kind, input.renterId, negativeAdjustment);

  if (debit === availableAccount(input.renterId)) {
    const available = await accountBalance(tx, debit);
    if (available < minutes) throw new InsufficientHours(available, minutes);
  }

  const movement = await tx.one<{ id: string }>(
    `INSERT INTO movements (renter_id, kind, minutes, booking_id, purchase_id, note)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.renterId,
      input.kind,
      minutes,
      input.bookingId ?? null,
      input.purchaseId ?? null,
      input.note ?? null,
    ],
  );
  await tx.query(
    `INSERT INTO ledger_entries (movement_id, renter_id, account, direction, minutes)
     VALUES ($1, $2, $3, 'debit', $5), ($1, $2, $4, 'credit', $5)`,
    [movement.id, input.renterId, debit, credit, minutes],
  );
  return movement.id;
}
