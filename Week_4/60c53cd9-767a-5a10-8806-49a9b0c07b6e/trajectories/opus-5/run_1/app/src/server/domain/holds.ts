/** Holds: placing, releasing, sharing, converting, and the unit states they drive. */

import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction, type Db } from '../db';
import { now, plusSeconds } from '../clock';
import { config } from '../config';
import { ApiError } from '../errors';
import { applyLapseCheck } from './lapse';
import { lockUnit } from './units';
import { reHoldCooldownUntil } from './limits';
import { queueIndexUpdate, waitForIndexConfirmation } from '../search/pending';
import { formatSalesOfficeTime } from '../../shared/salesOfficeTime';
import type { Hold, HoldEndReason, HoldStatus } from '../../shared/types';

export interface HoldRow {
  id: string;
  unit_code: string;
  account_id: string;
  status: HoldStatus;
  ended_by: HoldEndReason | null;
  quoted_price: string;
  price_version: number;
  created_at: Date;
  ends_at: Date;
  ended_at: Date | null;
  share_token: string | null;
}

const HOLD_COLUMNS = `id, unit_code, account_id, status, ended_by, quoted_price::text as quoted_price,
  price_version, created_at, ends_at, ended_at, share_token`;

export function publicHold(row: HoldRow): Hold {
  return {
    id: row.id,
    unitCode: row.unit_code,
    status: row.status,
    endedBy: row.ended_by,
    quotedPrice: Number(row.quoted_price),
    priceVersion: row.price_version,
    createdAt: row.created_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    shareUrl: row.share_token ? `/shared/${row.share_token}` : null,
  };
}

export async function loadHoldForAccount(db: Db, holdId: string, accountId: string): Promise<HoldRow | null> {
  return queryOne<HoldRow>(db, `select ${HOLD_COLUMNS} from holds where id = $1 and account_id = $2`, [
    holdId,
    accountId,
  ]);
}

export async function loadHold(db: Db, holdId: string): Promise<HoldRow | null> {
  return queryOne<HoldRow>(db, `select ${HOLD_COLUMNS} from holds where id = $1`, [holdId]);
}

export async function holdsForAccount(db: Db, accountId: string): Promise<HoldRow[]> {
  return query<HoldRow>(db, `select ${HOLD_COLUMNS} from holds where account_id = $1 order by created_at desc`, [
    accountId,
  ]);
}

export async function activeHoldForUnit(db: Db, unitCode: string): Promise<HoldRow | null> {
  return queryOne<HoldRow>(db, `select ${HOLD_COLUMNS} from holds where unit_code = $1 and status = 'active'`, [
    unitCode,
  ]);
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === constraint
  );
}

export interface PlaceHoldInput {
  accountId: string;
  unitCode: string;
  priceVersion: number;
}

/**
 * Places a hold at the price version the buyer saw. The conflict order is
 * hold_limit, then unit_reserved or unit_unavailable, then hold_cooldown,
 * then price_changed.
 */
export async function placeHold(client: PoolClient, input: PlaceHoldInput): Promise<Hold> {
  await applyLapseCheck(client);
  const unit = await lockUnit(client, input.unitCode);
  if (!unit || unit.status === 'withdrawn' || unit.status === 'unreleased') throw new ApiError('not_found');

  const existing = await queryOne<{ id: string }>(
    client,
    "select id from holds where account_id = $1 and status = 'active'",
    [input.accountId],
  );
  if (existing) throw new ApiError('hold_limit');

  if (unit.status === 'reserved') throw new ApiError('unit_reserved');
  if (unit.status === 'held') throw new ApiError('unit_unavailable');

  const cooldownUntil = await reHoldCooldownUntil(client, input.accountId, input.unitCode);
  if (cooldownUntil) {
    throw new ApiError('hold_cooldown', {
      placeholders: { 'end time': formatSalesOfficeTime(cooldownUntil, config.salesOfficeTz) },
    });
  }

  if (unit.price_version !== input.priceVersion) throw new ApiError('price_changed');

  const createdAt = now();
  let row: HoldRow | null = null;
  try {
    row = await queryOne<HoldRow>(
      client,
      `insert into holds (id, unit_code, account_id, status, quoted_price, price_version, created_at, ends_at)
       values ($1, $2, $3, 'active', $4, $5, $6, $7)
       returning ${HOLD_COLUMNS}`,
      [
        randomUUID(),
        unit.code,
        input.accountId,
        Number(unit.price),
        unit.price_version,
        createdAt,
        plusSeconds(createdAt, config.holdSeconds),
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error, 'holds_one_active_per_unit')) throw new ApiError('unit_unavailable');
    if (isUniqueViolation(error, 'holds_one_active_per_account')) throw new ApiError('hold_limit');
    throw error;
  }
  if (!row) throw new ApiError('unit_unavailable');

  await query(client, "update units set status = 'held' where code = $1", [unit.code]);
  await queueIndexUpdate(client, unit.code, 'upsert');
  return publicHold(row);
}

async function lockHoldAndUnit(
  client: PoolClient,
  holdId: string,
  accountId: string | null,
): Promise<HoldRow> {
  await applyLapseCheck(client);
  const preview = accountId ? await loadHoldForAccount(client, holdId, accountId) : await loadHold(client, holdId);
  if (!preview) throw new ApiError('not_found');
  await lockUnit(client, preview.unit_code);
  const row = await queryOne<HoldRow>(client, `select ${HOLD_COLUMNS} from holds where id = $1 for update`, [holdId]);
  if (!row) throw new ApiError('not_found');
  return row;
}

export async function releaseHold(holdId: string, accountId: string): Promise<Hold> {
  return withTransaction(async (client) => {
    const row = await lockHoldAndUnit(client, holdId, accountId);
    if (row.status !== 'active') throw new ApiError('hold_ended');
    const endedAt = now();
    const updated = await queryOne<HoldRow>(
      client,
      `update holds set status = 'released', ended_by = 'buyer', ended_at = $2, share_token = null
        where id = $1 returning ${HOLD_COLUMNS}`,
      [holdId, endedAt],
    );
    await query(client, "update units set status = 'available' where code = $1 and status = 'held'", [row.unit_code]);
    await queueIndexUpdate(client, row.unit_code, 'upsert');
    if (!updated) throw new ApiError('not_found');
    return publicHold(updated);
  });
}

export async function createShareLink(holdId: string, accountId: string): Promise<string> {
  return withTransaction(async (client) => {
    const row = await lockHoldAndUnit(client, holdId, accountId);
    if (row.status !== 'active') throw new ApiError('hold_ended');
    const token = randomBytes(32).toString('base64url');
    await query(client, 'update holds set share_token = $2 where id = $1', [holdId, token]);
    return `/shared/${token}`;
  });
}

export async function revokeShareLink(holdId: string, accountId: string): Promise<void> {
  await withTransaction(async (client) => {
    await applyLapseCheck(client);
    const row = await loadHoldForAccount(client, holdId, accountId);
    if (!row) throw new ApiError('not_found');
    await query(client, 'update holds set share_token = null where id = $1', [holdId]);
  });
}

export async function convertHold(holdId: string): Promise<Hold> {
  return withTransaction(async (client) => {
    const row = await lockHoldAndUnit(client, holdId, null);
    if (row.status !== 'active') throw new ApiError('hold_ended');
    const endedAt = now();
    const updated = await queryOne<HoldRow>(
      client,
      `update holds set status = 'converted', ended_by = 'conversion', ended_at = $2, share_token = null
        where id = $1 returning ${HOLD_COLUMNS}`,
      [holdId, endedAt],
    );
    await query(client, "update units set status = 'reserved' where code = $1 and status = 'held'", [row.unit_code]);
    await queueIndexUpdate(client, row.unit_code, 'upsert');
    if (!updated) throw new ApiError('not_found');
    return publicHold(updated);
  });
}

/** Withdrawal is final: the unit leaves the market and any active hold on it ends. */
export async function withdrawUnit(code: string): Promise<void> {
  await withTransaction(async (client) => {
    await applyLapseCheck(client);
    const unit = await lockUnit(client, code);
    if (!unit) throw new ApiError('not_found');
    if (unit.status === 'withdrawn') throw new ApiError('unit_withdrawn');
    if (unit.status === 'unreleased') throw new ApiError('not_released');
    await query(client, "update units set status = 'withdrawn' where code = $1", [code]);
    await query(
      client,
      `update holds set status = 'released', ended_by = 'withdrawal', ended_at = $2, share_token = null
        where unit_code = $1 and status = 'active'`,
      [code, now()],
    );
    await queueIndexUpdate(client, code, 'delete');
  });
  await waitForIndexConfirmation([code], 5000);
}
