import type { PoolClient } from 'pg';
import type { DamageKind, DamageReport, DamageStatus } from '../../shared/types';
import { query, queryOne } from '../db/pool';
import { studioLabel } from '../domain/time';

interface DamageRow {
  id: string;
  piece_number: string;
  firing_id: string;
  kind: DamageKind;
  note: string;
  status: DamageStatus;
  unload_photo_id: string | null;
  amount_cents: number | null;
  reported_by: string;
  reported_at: Date;
  intake_photo_id: string | null;
  account_name: string;
  owner_user_id: string | null;
  kb_account_id: string | null;
  guest_email: string | null;
  owner_kind: 'member' | 'guest';
}

const DAMAGE_SELECT = `
select d.*, p.intake_photo_id, p.owner_user_id, p.kb_account_id, p.guest_email, p.owner_kind,
       coalesce(u.name, p.guest_name) as account_name
from damage_reports d
join pieces p on p.number = d.piece_number
left join users u on u.id = p.owner_user_id`;

export function toDamageReport(row: DamageRow): DamageReport {
  return {
    id: row.id,
    piece_number: row.piece_number,
    kind: row.kind,
    note: row.note,
    status: row.status,
    intake_photo_id: row.intake_photo_id,
    unload_photo_id: row.unload_photo_id,
    account_name: row.account_name,
    amount_cents: row.amount_cents,
    reported_by: row.reported_by,
    reported_at: row.reported_at.toISOString(),
    reported_at_label: studioLabel(row.reported_at),
  };
}

export async function listDamageReports(): Promise<DamageReport[]> {
  const rows = await query<DamageRow>(`${DAMAGE_SELECT} order by d.reported_at desc, d.id`);
  return rows.map(toDamageReport);
}

export async function findDamageRow(id: unknown): Promise<DamageRow | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<DamageRow>(`${DAMAGE_SELECT} where d.id = $1`, [id]);
}

export async function insertDamageReport(
  client: PoolClient,
  args: {
    pieceNumber: string;
    firingId: string;
    kind: DamageKind;
    note: string;
    unloadPhotoId: string;
    reportedBy: string;
  },
): Promise<void> {
  await client.query(
    `insert into damage_reports (piece_number, firing_id, kind, note, unload_photo_id, reported_by)
     values ($1, $2, $3, $4, $5, $6)`,
    [args.pieceNumber, args.firingId, args.kind, args.note, args.unloadPhotoId, args.reportedBy],
  );
}

/** Settles a report once; a second attempt finds nothing to change. */
export async function settleDamageReport(
  client: PoolClient,
  args: { id: string; status: Extract<DamageStatus, 'charged' | 'waived'>; amountCents: number | null },
): Promise<boolean> {
  const result = await client.query(
    `update damage_reports set status = $2, amount_cents = $3, settled_at = now()
     where id = $1 and status = 'reported'`,
    [args.id, args.status, args.amountCents],
  );
  return result.rowCount === 1;
}

export async function openDamageCount(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "select count(*)::text as count from damage_reports where status = 'reported'",
  );
  return Number(row?.count ?? '0');
}

export type { DamageRow };
