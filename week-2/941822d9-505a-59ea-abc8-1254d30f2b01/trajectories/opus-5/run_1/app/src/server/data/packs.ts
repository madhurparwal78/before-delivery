import { one, query, withSerializable, type Queryable } from '../db/pool.js';
import { hasExpired, plusSeconds } from '../domain/expiry.js';
import { formatMoney } from '../domain/money.js';
import { instantToIso, plusCalendarMonths } from '../domain/providerTime.js';
import {
  LEDGER_ACCOUNTS,
  movementEntries,
  type LedgerMovementKind,
} from '../domain/seatLedger.js';
import { newId } from '../util/ids.js';
import { config } from '../config.js';

export interface PackRow {
  readonly id: string;
  readonly organisation_id: string;
  readonly course_id: string;
  readonly seats_purchased: number;
  readonly price_total_cents: number;
  readonly purchased_at: Date;
  readonly expires_at: Date;
  readonly expiry_settled_at: Date | null;
  readonly course_title: string;
}

const PACK_SELECT = `
  SELECT p.id, p.organisation_id, p.course_id, p.seats_purchased, p.price_total_cents,
         p.purchased_at, p.expires_at, p.expiry_settled_at, c.title AS course_title
  FROM packs p JOIN courses c ON c.id = p.course_id
`;

export async function getPack(client: Queryable, id: string): Promise<PackRow | null> {
  return one<PackRow>(client, `${PACK_SELECT} WHERE p.id = $1`, [id]);
}

export async function listPacks(client: Queryable, organisationId: string): Promise<PackRow[]> {
  return query<PackRow>(client, `${PACK_SELECT} WHERE p.organisation_id = $1 ORDER BY p.purchased_at DESC`, [
    organisationId,
  ]);
}

/** A pack expires twelve calendar months after purchase, or after the configured seconds. */
export function packExpiresAt(purchasedAt: Date): Date {
  return config.seatExpirySeconds === null
    ? plusCalendarMonths(purchasedAt, 12)
    : plusSeconds(purchasedAt, config.seatExpirySeconds);
}

/** The balance is the sum of the pack-account entries, computed from the ledger. */
export async function packBalance(client: Queryable, packId: string): Promise<number> {
  const row = await one<{ balance: string }>(
    client,
    `SELECT coalesce(sum(seats), 0)::text AS balance FROM ledger_entries
     WHERE pack_id = $1 AND account = $2`,
    [packId, LEDGER_ACCOUNTS.pack],
  );
  return row === null ? 0 : Number.parseInt(row.balance, 10);
}

export async function postMovement(
  client: Queryable,
  input: {
    packId: string;
    kind: LedgerMovementKind;
    seats: number;
    nurseId: string | null;
    assignmentId: string | null;
  },
): Promise<string> {
  const movementId = newId();
  await client.query(
    `INSERT INTO ledger_movements (id, pack_id, kind, assignment_id) VALUES ($1, $2, $3, $4)`,
    [movementId, input.packId, input.kind, input.assignmentId],
  );
  for (const entry of movementEntries(input.kind, input.seats, input.nurseId)) {
    await client.query(
      `INSERT INTO ledger_entries (id, movement_id, pack_id, account, seats, assignment_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId(), movementId, input.packId, entry.account, entry.seats, input.assignmentId],
    );
  }
  return movementId;
}

/**
 * At or after its expiry instant, the first request to touch a pack posts one expiry
 * movement for whatever is left and marks the pack expired.
 */
export async function settlePackExpiry(packId: string, at: Date): Promise<void> {
  await withSerializable(async (client) => {
    const pack = await one<{ expires_at: Date; expiry_settled_at: Date | null }>(
      client,
      'SELECT expires_at, expiry_settled_at FROM packs WHERE id = $1 FOR UPDATE',
      [packId],
    );
    if (pack === null || pack.expiry_settled_at !== null) return;
    if (!hasExpired(pack.expires_at, at)) return;
    const balance = await packBalance(client, packId);
    if (balance > 0) {
      await postMovement(client, { packId, kind: 'expiry', seats: balance, nurseId: null, assignmentId: null });
    }
    await client.query('UPDATE packs SET expiry_settled_at = now() WHERE id = $1', [packId]);
  });
}

export async function settleExpiryForOrganisation(
  client: Queryable,
  organisationId: string,
  at: Date,
): Promise<void> {
  const due = await query<{ id: string }>(
    client,
    `SELECT id FROM packs WHERE organisation_id = $1 AND expiry_settled_at IS NULL AND expires_at <= $2`,
    [organisationId, at],
  );
  for (const pack of due) await settlePackExpiry(pack.id, at);
}

export interface PackJson {
  readonly id: string;
  readonly course_id: string;
  readonly course_title: string;
  readonly seats_purchased: number;
  readonly balance: number;
  readonly price_total: string;
  readonly purchased_at: string;
  readonly expires_at: string;
  readonly state: 'active' | 'expired';
}

export async function packJson(client: Queryable, pack: PackRow, at: Date): Promise<PackJson> {
  return {
    id: pack.id,
    course_id: pack.course_id,
    course_title: pack.course_title,
    seats_purchased: pack.seats_purchased,
    balance: await packBalance(client, pack.id),
    price_total: formatMoney(pack.price_total_cents),
    purchased_at: instantToIso(pack.purchased_at),
    expires_at: instantToIso(pack.expires_at),
    state: hasExpired(pack.expires_at, at) ? 'expired' : 'active',
  };
}

export interface LedgerEntryJson {
  readonly movement_id: string;
  readonly kind: LedgerMovementKind;
  readonly account: string;
  readonly seats: number;
  readonly assignment_id: string | null;
  readonly posted_at: string;
}

export async function ledgerJson(client: Queryable, packId: string): Promise<LedgerEntryJson[]> {
  const rows = await query<{
    movement_id: string;
    kind: LedgerMovementKind;
    account: string;
    seats: number;
    assignment_id: string | null;
    posted_at: Date;
  }>(
    client,
    `SELECT le.movement_id, lm.kind, le.account, le.seats, le.assignment_id, le.posted_at
     FROM ledger_entries le JOIN ledger_movements lm ON lm.id = le.movement_id
     WHERE le.pack_id = $1 ORDER BY le.seq`,
    [packId],
  );
  return rows.map((row) => ({
    movement_id: row.movement_id,
    kind: row.kind,
    account: row.account,
    seats: row.seats,
    assignment_id: row.assignment_id,
    posted_at: instantToIso(row.posted_at),
  }));
}
