import { newId, type Db } from "../db";

const accounts = {
  wallet: (memberId: string): string => `wallet:${memberId}`,
  held: (bookingId: string): string => `held:${bookingId}`,
  earnings: (driverId: string): string => `earnings:${driverId}`,
  topups: "network:topups",
} as const;

type LedgerKind = "top_up" | "payment" | "request_released" | "passenger_cancellation" | "driver_cancellation" | "completion";

interface Line {
  account: string;
  amountCents: number;
}

/** Every money movement is one entry whose lines sum to zero. */
async function writeEntry(db: Db, entry: { bookingId: string | null; kind: LedgerKind; label: string | null; at: Date; lines: Line[] }): Promise<string> {
  const total = entry.lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (total !== 0) throw new Error("ledger entry lines must cancel out");
  const id = newId();
  await db.query("INSERT INTO ledger_entries (id, booking_id, kind, label, at) VALUES ($1, $2, $3, $4, $5)", [id, entry.bookingId, entry.kind, entry.label, entry.at]);
  for (const line of entry.lines) {
    await db.query("INSERT INTO ledger_lines (id, entry_id, account, amount_cents) VALUES ($1, $2, $3, $4)", [newId(), id, line.account, line.amountCents]);
  }
  return id;
}

export async function walletBalance(db: Db, memberId: string): Promise<number> {
  const { rows } = await db.query<{ total: number }>("SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total FROM ledger_lines WHERE account = $1", [accounts.wallet(memberId)]);
  return rows[0]?.total ?? 0;
}

export function recordTopUp(db: Db, memberId: string, amountCents: number, at: Date): Promise<string> {
  return writeEntry(db, {
    bookingId: null, kind: "top_up", label: "Added to wallet", at,
    lines: [{ account: accounts.topups, amountCents: -amountCents }, { account: accounts.wallet(memberId), amountCents }],
  });
}

export function recordPayment(db: Db, bookingId: string, memberId: string, paidCents: number, label: string, at: Date): Promise<string> {
  return writeEntry(db, {
    bookingId, kind: "payment", label, at,
    lines: [{ account: accounts.wallet(memberId), amountCents: -paidCents }, { account: accounts.held(bookingId), amountCents: paidCents }],
  });
}

export function recordRequestRelease(db: Db, bookingId: string, memberId: string, paidCents: number, label: string, at: Date): Promise<string> {
  return writeEntry(db, {
    bookingId, kind: "request_released", label, at,
    lines: [{ account: accounts.held(bookingId), amountCents: -paidCents }, { account: accounts.wallet(memberId), amountCents: paidCents }],
  });
}

export function recordPassengerCancellation(db: Db, bookingId: string, memberId: string, driverId: string, paidCents: number, refundCents: number, label: string, at: Date): Promise<string> {
  return writeEntry(db, {
    bookingId, kind: "passenger_cancellation", label, at,
    lines: [
      { account: accounts.held(bookingId), amountCents: -paidCents },
      { account: accounts.wallet(memberId), amountCents: refundCents },
      { account: accounts.earnings(driverId), amountCents: paidCents - refundCents },
    ],
  });
}

export function recordDriverCancellation(db: Db, bookingId: string, memberId: string, driverId: string, paidCents: number, label: string, at: Date): Promise<string> {
  return writeEntry(db, {
    bookingId, kind: "driver_cancellation", label, at,
    lines: [
      { account: accounts.held(bookingId), amountCents: -paidCents },
      { account: accounts.wallet(memberId), amountCents: paidCents },
      { account: accounts.earnings(driverId), amountCents: 0 },
    ],
  });
}

export function recordCompletion(db: Db, bookingId: string, driverId: string, paidCents: number, at: Date): Promise<string> {
  return writeEntry(db, {
    bookingId, kind: "completion", label: null, at,
    lines: [{ account: accounts.held(bookingId), amountCents: -paidCents }, { account: accounts.earnings(driverId), amountCents: paidCents }],
  });
}

interface WalletLineRow {
  id: string;
  entry_id: string;
  label: string;
  amount_cents: number;
  at: Date;
}

/** One line per entry that touches the member's wallet, newest first. */
export async function walletLines(db: Db, memberId: string): Promise<WalletLineRow[]> {
  const { rows } = await db.query<WalletLineRow>(
    `SELECT l.id, l.entry_id, e.label, l.amount_cents, e.at
       FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
      WHERE l.account = $1 ORDER BY e.seq DESC, l.seq DESC`,
    [accounts.wallet(memberId)],
  );
  return rows;
}

interface EntryRow {
  id: string;
  kind: LedgerKind;
  at: Date;
  lines: { account: string; amount_cents: number }[];
}

export async function bookingEntries(db: Db, bookingId: string): Promise<EntryRow[]> {
  const { rows } = await db.query<EntryRow>(
    `SELECT e.id, e.kind, e.at,
            (SELECT json_agg(json_build_object('account', l.account, 'amount_cents', l.amount_cents) ORDER BY l.seq)
               FROM ledger_lines l WHERE l.entry_id = e.id) AS lines
       FROM ledger_entries e WHERE e.booking_id = $1 ORDER BY e.seq`,
    [bookingId],
  );
  return rows;
}

interface BookingMoney {
  paid_cents: number;
  refunded_cents: number;
  earned_cents: number;
}

/** What the ledger says a booking cost, returned and earned (the earnings statement reads this). */
export async function bookingMoney(db: Db, bookingId: string): Promise<BookingMoney> {
  const { rows } = await db.query<BookingMoney>(
    `SELECT COALESCE(SUM(CASE WHEN l.account LIKE 'held:%' AND l.amount_cents > 0 THEN l.amount_cents END), 0)::bigint AS paid_cents,
            COALESCE(SUM(CASE WHEN l.account LIKE 'wallet:%' AND l.amount_cents > 0 THEN l.amount_cents END), 0)::bigint AS refunded_cents,
            COALESCE(SUM(CASE WHEN l.account LIKE 'earnings:%' THEN l.amount_cents END), 0)::bigint AS earned_cents
       FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id WHERE e.booking_id = $1`,
    [bookingId],
  );
  return rows[0] ?? { paid_cents: 0, refunded_cents: 0, earned_cents: 0 };
}
