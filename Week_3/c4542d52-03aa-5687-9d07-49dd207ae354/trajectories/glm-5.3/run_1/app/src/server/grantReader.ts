import type { PoolClient } from 'pg';
import type { GrantRow } from './register.js';
import { dateStr as pgDateStr } from './pgtypes.js';

/** Normalizes a raw grant row (joined with the holder's departure) into a GrantRow. */
export function grantRowFrom(raw: Record<string, unknown>): GrantRow {
  return {
    id: raw.id as string,
    holder_id: raw.holder_id as string,
    holder_name: (raw.holder_name as string) ?? '',
    options: Number(raw.options),
    strike: raw.strike as string,
    vesting_type: raw.vesting_type as 'standard' | 'monthly',
    vesting_start: pgDateStr(raw.vesting_start as string | Date) ?? '',
    state: raw.state as GrantRow['state'],
    draft_version: Number(raw.draft_version ?? 1),
    offered_at: raw.offered_at ? new Date(raw.offered_at as string) : null,
    offer_expires_at: raw.offer_expires_at ? new Date(raw.offer_expires_at as string) : null,
    accepted_at: raw.accepted_at ? new Date(raw.accepted_at as string) : null,
    agreement_document_id: (raw.agreement_document_id as string) ?? null,
    forfeited: Number(raw.forfeited ?? 0),
    cancelled: Number(raw.cancelled ?? 0),
    created_at: new Date(raw.created_at as string),
    termination_date: pgDateStr((raw.termination_date as string | Date | null) ?? null),
    window_ends_at: raw.window_ends_at ? new Date(raw.window_ends_at as string) : null,
  };
}

/** Reads one grant joined with its holder's departure. */
export async function readGrant(client: PoolClient, id: string): Promise<GrantRow | null> {
  const r = await client.query(
    `SELECT g.*, p.termination_date, p.window_ends_at, p.name AS holder_name
     FROM grants g JOIN people p ON p.id = g.holder_id WHERE g.id = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? grantRowFrom(row) : null;
}

/** Reads every grant joined with its holder's departure. */
export async function readGrants(client: PoolClient, where?: string, params: unknown[] = []): Promise<GrantRow[]> {
  const join = `SELECT g.*, p.termination_date, p.window_ends_at, p.name AS holder_name
     FROM grants g JOIN people p ON p.id = g.holder_id ${where ? 'WHERE ' + where : ''}`;
  const r = await client.query(join, params);
  return r.rows.map((row: Record<string, unknown>) => grantRowFrom(row));
}
