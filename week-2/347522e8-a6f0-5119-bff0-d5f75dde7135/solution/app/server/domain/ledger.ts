// The paired hour ledger. Every movement is one debit and one credit of the same positive minutes
// on two accounts; balances are always sums of entries, never stored.

import { randomUUID } from "node:crypto";
import type { LedgerEntryView, LedgerView, MovementKind } from "../../shared/api.js";
import { iso, now } from "../clock.js";
import { availableAccount, balanceOf, heldAccount } from "../../shared/ledger.js";
import { type Db, type Tx, rows } from "../db.js";
import { fail } from "../http/errors.js";

/** Debit → credit for each movement kind (a negative adjustment is reversed). */
const ROUTES: Record<MovementKind, (renterId: string) => [string, string]> = {
  opening_balance: (r) => ["kitchen:opening", availableAccount(r)],
  pack_purchase: (r) => ["kitchen:sold", availableAccount(r)],
  booking_hold: (r) => [availableAccount(r), heldAccount(r)],
  hold_release: (r) => [heldAccount(r), availableAccount(r)],
  cancellation_credit: (r) => [heldAccount(r), availableAccount(r)],
  displacement_credit: (r) => [heldAccount(r), availableAccount(r)],
  checkout: (r) => [heldAccount(r), "kitchen:consumed"],
  cancellation_forfeit: (r) => [heldAccount(r), "kitchen:forfeited"],
  adjustment: (r) => ["kitchen:adjustments", availableAccount(r)],
};

interface Balances {
  balance_minutes: number;
  held_minutes: number;
}

interface PostingRow {
  account: string;
  direction: "debit" | "credit";
  minutes: number;
}

/** The renter's balances from their entries (only entries before `before`, when given). */
export async function balancesOf(db: Db, renterId: string, before?: number): Promise<Balances> {
  const available = availableAccount(renterId);
  const held = heldAccount(renterId);
  const entries = await rows<PostingRow>(
    db,
    "SELECT account, direction, minutes FROM ledger_entries WHERE account IN ($1, $2) AND ($3::timestamptz IS NULL OR created_at < $3)",
    [available, held, before === undefined ? null : iso(before)],
  );
  return { balance_minutes: balanceOf(entries, available), held_minutes: balanceOf(entries, held) };
}

/** Locks the renter row so hour movements for that renter happen one at a time. */
export async function lockRenterHours(tx: Tx, renterId: string): Promise<void> {
  await tx.query("SELECT 1 FROM renters WHERE id = $1 FOR UPDATE", [renterId]);
}

interface MovementRefs {
  bookingId?: string;
  purchaseId?: string;
  note?: string;
}

/**
 * Records one movement. `minutes` is positive, except an adjustment, whose sign says which way it
 * goes. A movement that would take the available balance below zero answers insufficient_hours.
 * The caller holds `lockRenterHours` for the renter.
 */
export async function recordMovement(tx: Tx, renterId: string, kind: MovementKind, minutes: number, refs: MovementRefs = {}): Promise<string> {
  const [routeDebit, routeCredit] = ROUTES[kind](renterId);
  const [debit, credit] = minutes < 0 ? [routeCredit, routeDebit] : [routeDebit, routeCredit];
  const amount = Math.abs(minutes);
  if (debit === availableAccount(renterId)) {
    const { balance_minutes } = await balancesOf(tx, renterId);
    if (balance_minutes < amount) throw fail(409, "insufficient_hours", { balance_minutes, needed_minutes: amount });
  }
  const movementId = randomUUID();
  const at = iso(now());
  const values = [movementId, kind, refs.bookingId ?? null, refs.purchaseId ?? null, refs.note ?? null, at, amount];
  await tx.query(
    `INSERT INTO ledger_entries (movement_id, kind, account, direction, minutes, booking_id, purchase_id, note, created_at)
     VALUES ($1, $2, $8, 'debit', $7, $3, $4, $5, $6), ($1, $2, $9, 'credit', $7, $3, $4, $5, $6)`,
    [...values, debit, credit],
  );
  return movementId;
}

interface EntryRow {
  id: number;
  movement_id: string;
  kind: MovementKind;
  account: string;
  direction: "debit" | "credit";
  minutes: number;
  booking_id: string | null;
  purchase_id: string | null;
  note: string | null;
  created_at: Date;
}

/** Both entries of every movement that touches the renter's accounts, oldest first. */
export async function ledgerOf(db: Db, renterId: string): Promise<LedgerView> {
  const entries = await rows<EntryRow>(
    db,
    `SELECT * FROM ledger_entries WHERE movement_id IN (
       SELECT movement_id FROM ledger_entries WHERE account IN ($1, $2)) ORDER BY id`,
    [availableAccount(renterId), heldAccount(renterId)],
  );
  return {
    ...(await balancesOf(db, renterId)),
    entries: entries.map(
      (entry): LedgerEntryView => ({
        id: String(entry.id),
        movement_id: entry.movement_id,
        kind: entry.kind,
        account: entry.account,
        direction: entry.direction,
        minutes: entry.minutes,
        booking_id: entry.booking_id,
        purchase_id: entry.purchase_id,
        note: entry.note,
        created_at: iso(entry.created_at),
      }),
    ),
  };
}
