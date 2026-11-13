import type { LedgerEntry, LedgerKind, Person, ShareClass } from "../shared/types.js";
import { nextId, only, query, type Tx } from "./db.js";
import { forbidden } from "./errors.js";
import { iso, now } from "./time.js";

type LedgerRow = {
  id: string;
  at: Date;
  holder_id: string | null;
  holder_name: string | null;
  kind: LedgerKind;
  class: ShareClass | null;
  shares_delta: number;
  options_delta: number;
  reference: string;
};

const presentEntry = (row: LedgerRow): LedgerEntry => ({ ...row, at: iso(row.at) });

const SELECT_ENTRIES = `SELECT l.id, l.at, l.holder_id, p.name AS holder_name, l.kind, l.class, l.shares_delta, l.options_delta, l.reference
  FROM ledger l LEFT JOIN people p ON p.id = l.holder_id`;

/** The one way a holder's issued shares or outstanding options change: one entry per holder affected. */
export async function writeLedgerEntry(
  tx: Tx,
  entry: { holderId: string | null; kind: LedgerKind; shareClass: ShareClass | null; sharesDelta: number; optionsDelta: number; reference: string },
): Promise<LedgerEntry> {
  const id = await nextId(tx, "ledger_number", "LED-", 6);
  await tx.query(
    `INSERT INTO ledger (id, at, holder_id, kind, class, shares_delta, options_delta, reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, now(), entry.holderId, entry.kind, entry.shareClass, entry.sharesDelta, entry.optionsDelta, entry.reference],
  );
  tx.emit({ to: null, type: "changed", data: { topics: ["registry"] } });
  return presentEntry(only(await tx.query<LedgerRow>(`${SELECT_ENTRIES} WHERE l.id = $1`, [id])));
}

export async function listLedger(person: Person): Promise<LedgerEntry[]> {
  if (person.role === "board_member") throw forbidden();
  const rows =
    person.role === "founder_admin"
      ? await query<LedgerRow>(`${SELECT_ENTRIES} ORDER BY l.position DESC`)
      : await query<LedgerRow>(`${SELECT_ENTRIES} WHERE l.holder_id = $1 ORDER BY l.position DESC`, [person.id]);
  return rows.map(presentEntry);
}
