import { rows, type Db, type Tx } from "./db.js";

// Hour ledger (DP-09). Every movement is exactly two equal and opposite
// entries on two different accounts. Balances are always derived by summing
// entries; no balance is stored separately.

export type AccountPair = {
  movementKind:
    | "opening_balance"
    | "pack_purchase"
    | "booking_hold"
    | "hold_release"
    | "cancellation_credit"
    | "displacement_credit"
    | "checkout"
    | "cancellation_forfeit"
    | "adjustment";
  debitAccount: string;
  creditAccount: string;
};

export const availableAccount = (renterId: string) => `renter:${renterId}:available`;
export const heldAccount = (renterId: string) => `renter:${renterId}:held`;

const kitchenOpening = "kitchen:opening";
const kitchenSold = "kitchen:sold";
const kitchenConsumed = "kitchen:consumed";
const kitchenForfeited = "kitchen:forfeited";
const kitchenAdjustments = "kitchen:adjustments";

// The movement table from the brief, decided in this one place.
export const movementAccounts = (movement: AccountPair["movementKind"], renterId: string, minutes: number): AccountPair => {
  const available = availableAccount(renterId);
  const held = heldAccount(renterId);
  switch (movement) {
    case "opening_balance":
      return { movementKind: movement, debitAccount: kitchenOpening, creditAccount: available };
    case "pack_purchase":
      return { movementKind: movement, debitAccount: kitchenSold, creditAccount: available };
    case "booking_hold":
      return { movementKind: movement, debitAccount: available, creditAccount: held };
    case "hold_release":
    case "cancellation_credit":
    case "displacement_credit":
      return { movementKind: movement, debitAccount: held, creditAccount: available };
    case "checkout":
      return { movementKind: movement, debitAccount: held, creditAccount: kitchenConsumed };
    case "cancellation_forfeit":
      return { movementKind: movement, debitAccount: held, creditAccount: kitchenForfeited };
    case "adjustment":
      return minutes > 0
        ? { movementKind: movement, debitAccount: kitchenAdjustments, creditAccount: available }
        : { movementKind: movement, debitAccount: available, creditAccount: kitchenAdjustments };
  }
};

export type MovementRef = { bookingId?: string; purchaseId?: string; note?: string };

export const recordMovement = async (
  tx: Tx,
  renterId: string,
  movement: AccountPair["movementKind"],
  minutes: number,
  ref: MovementRef,
): Promise<string> => {
  const magnitude = Math.abs(minutes);
  const pair = movementAccounts(movement, renterId, minutes);
  const inserted = await rows<{ id: string }>(
    tx,
    "insert into movements (renter_id, kind, minutes, note) values ($1, $2, $3, $4) returning id",
    [renterId, movement, magnitude, ref.note ?? null],
  );
  const movementId = inserted[0]!.id;
  await tx.query(
    "insert into ledger_entries (movement_id, renter_id, account, direction, minutes, booking_id, purchase_id) values ($1,$2,$3,'debit',$4,$5,$6), ($1,$2,$7,'credit',$4,$5,$6)",
    [movementId, renterId, pair.debitAccount, magnitude, ref.bookingId ?? null, ref.purchaseId ?? null, pair.creditAccount],
  );
  return movementId;
};

export type Balances = { balanceMinutes: number; heldMinutes: number };

export const balances = async (db: Db, renterId: string): Promise<Balances> => {
  const result = await rows<{ account: string; direction: string; total: string }>(
    db,
    `select account, direction, sum(minutes)::text as total
     from ledger_entries where renter_id = $1 and account in ($2, $3)
     group by account, direction`,
    [renterId, availableAccount(renterId), heldAccount(renterId)],
  );
  let balance = 0;
  let held = 0;
  for (const row of result) {
    const value = Number(row.total);
    if (row.account === availableAccount(renterId)) {
      balance += row.direction === "credit" ? value : -value;
    } else {
      held += row.direction === "credit" ? value : -value;
    }
  }
  return { balanceMinutes: balance, heldMinutes: held };
};

export type LedgerEntry = {
  id: string;
  movement_id: string;
  kind: string;
  account: string;
  direction: "debit" | "credit";
  minutes: number;
  booking_id: string | null;
  purchase_id: string | null;
  note: string | null;
  created_at: string | Date;
};

export const ledgerForAccount = async (
  db: Db,
  renterId: string,
  account: string,
): Promise<LedgerEntry[]> =>
  rows<LedgerEntry>(
    db,
    `select e.id, e.movement_id, m.kind, e.account, e.direction, e.minutes,
            e.booking_id, e.purchase_id, m.note, e.created_at
     from ledger_entries e join movements m on m.id = e.movement_id
     where e.renter_id = $1 and e.account = $2
     order by e.created_at asc, e.id asc`,
    [renterId, account],
  );
