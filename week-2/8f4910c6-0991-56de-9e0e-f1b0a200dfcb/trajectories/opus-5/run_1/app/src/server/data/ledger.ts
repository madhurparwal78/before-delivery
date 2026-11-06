import { query, type Tx } from '../db.js';
import { newId } from '../ids.js';
import { toIsoInstant } from '../../shared/zone.js';
import type { LedgerEntry, Movement, MovementKind } from '../../shared/types.js';

export type MovementRow = {
  id: string;
  kind: MovementKind;
  reference: string;
  talent_id: string | null;
  booking_id: string | null;
  client_id: string | null;
  reversal_of: string | null;
  reversed_by_movement: string | null;
  reversed_by_name: string | null;
  reversed_at: Date | null;
  description: string;
  created_by: string;
  created_by_name: string;
  created_at: Date;
  office_date: string;
};

export type EntryRow = { movement_id: string; account: string; amount_cents: number };

export function talentAccount(talentId: string): string {
  return `talent:${talentId}`;
}

export function clientAccount(clientId: string): string {
  return `client:${clientId}`;
}

export function movementView(row: MovementRow, entries: EntryRow[]): Movement {
  return {
    id: row.id,
    kind: row.kind,
    reference: row.reference,
    talentId: row.talent_id,
    bookingId: row.booking_id,
    reversalOf: row.reversal_of,
    reversedBy: row.reversed_by_name,
    createdBy: row.created_by_name,
    createdAt: toIsoInstant(row.created_at.getTime()),
    officeDate: row.office_date,
    entries: entries.map((entry): LedgerEntry => ({ account: entry.account, amountCents: entry.amount_cents })),
  };
}

export type NewMovement = {
  kind: MovementKind;
  reference: string;
  talentId: string | null;
  bookingId: string | null;
  clientId: string | null;
  reversalOf: string | null;
  description: string;
  createdBy: string;
  createdByName: string;
  officeDate: string;
  nowMs: number;
  entries: LedgerEntry[];
};

/** Every movement writes paired entries that sum to zero. */
export async function writeMovement(tx: Tx, input: NewMovement): Promise<string> {
  const id = newId('mov');
  await tx.query(
    `INSERT INTO movements (
       id, kind, reference, talent_id, booking_id, client_id, reversal_of, description,
       created_by, created_by_name, created_at, office_date
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      input.kind,
      input.reference,
      input.talentId,
      input.bookingId,
      input.clientId,
      input.reversalOf,
      input.description,
      input.createdBy,
      input.createdByName,
      new Date(input.nowMs),
      input.officeDate,
    ],
  );
  for (const entry of input.entries) {
    await tx.query('INSERT INTO ledger_entries (movement_id, account, amount_cents) VALUES ($1, $2, $3)', [
      id,
      entry.account,
      entry.amountCents,
    ]);
  }
  return id;
}

export async function findMovement(id: string): Promise<MovementRow | null> {
  const rows = await query<MovementRow>('SELECT * FROM movements WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function entriesOf(movementIds: string[]): Promise<Map<string, EntryRow[]>> {
  if (movementIds.length === 0) return new Map();
  const rows = await query<EntryRow>(
    'SELECT * FROM ledger_entries WHERE movement_id = ANY($1::text[]) ORDER BY id',
    [movementIds],
  );
  const map = new Map<string, EntryRow[]>();
  for (const row of rows) {
    const list = map.get(row.movement_id) ?? [];
    list.push(row);
    map.set(row.movement_id, list);
  }
  return map;
}

/** Movements that touch one talent's account, oldest first. */
export async function movementsTouchingTalent(talentId: string): Promise<MovementRow[]> {
  return query<MovementRow>(
    `SELECT DISTINCT m.* FROM movements m
     JOIN ledger_entries e ON e.movement_id = m.id
     WHERE e.account = $1
     ORDER BY m.office_date, m.created_at, m.id`,
    [talentAccount(talentId)],
  );
}

export async function balanceOfTalent(talentId: string): Promise<number> {
  const rows = await query<{ balance: number | null }>(
    'SELECT sum(amount_cents)::bigint AS balance FROM ledger_entries WHERE account = $1',
    [talentAccount(talentId)],
  );
  return rows[0]?.balance ?? 0;
}

export async function markReversed(
  tx: Tx,
  movementId: string,
  reversalId: string,
  reversedByName: string,
  nowMs: number,
): Promise<void> {
  await tx.query(
    `UPDATE movements SET reversed_by_movement = $2, reversed_by_name = $3, reversed_at = $4 WHERE id = $1`,
    [movementId, reversalId, reversedByName, new Date(nowMs)],
  );
}
