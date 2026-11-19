/** Hold endpoints: placing (with attempt limits and idempotent replay), reading, releasing and sharing. */

import type { PoolClient } from 'pg';
import { pool, query, queryOne, withTransaction } from '../db';
import { ApiError } from '../errors';
import { FIELD_MESSAGES } from '../../shared/errors';
import { applyLapseCheck } from '../domain/lapse';
import {
  createShareLink,
  holdsForAccount,
  loadHoldForAccount,
  placeHold,
  publicHold,
  releaseHold,
  revokeShareLink,
} from '../domain/holds';
import { countHoldAttempt } from '../domain/limits';
import { isVisibleToBuyers, loadUnit } from '../domain/units';
import { requireAccount, requireRole } from '../http/auth';
import {
  assertIdempotencyKeyShape,
  rawFieldToken,
  readIdempotencyKey,
  readIntegerField,
  sendEmpty,
  sendJson,
  sendText,
  type JsonBody,
  type Wire,
} from '../http/wire';
import type { AccountRecord } from '../domain/accounts';

/** The stored response is kept as its exact body text, so a replay is identical. */
interface StoredResponse {
  status: number;
  bodyText: string;
}

/** Thrown to roll the whole request back: a refused attempt stores and counts nothing. */
class AttemptsExhausted extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('hold attempts exhausted');
  }
}

type Claim =
  | { kind: 'claimed' }
  | { kind: 'reused' }
  | { kind: 'replay'; response: StoredResponse };

interface KeyRow {
  unit_code: string | null;
  price_version: string | null;
  response_status: number | null;
  response_body: string | null;
}

async function claimIdempotencyKey(
  client: PoolClient,
  accountId: string,
  key: string,
  unitCode: string | null,
  priceVersion: number | null,
): Promise<Claim> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = await queryOne<{ key: string }>(
      client,
      `insert into idempotency_keys (account_id, key, unit_code, price_version, created_at)
       values ($1, $2, $3, $4, now()) on conflict (account_id, key) do nothing returning key`,
      [accountId, key, unitCode, priceVersion],
    );
    if (inserted) return { kind: 'claimed' };
    const row = await queryOne<KeyRow>(
      client,
      `select unit_code, price_version, response_status, response_body
         from idempotency_keys where account_id = $1 and key = $2 for update`,
      [accountId, key],
    );
    if (!row) continue;
    const storedVersion = row.price_version === null ? null : Number(row.price_version);
    if (row.unit_code !== unitCode || storedVersion !== priceVersion) return { kind: 'reused' };
    if (row.response_status !== null && row.response_body !== null) {
      return { kind: 'replay', response: { status: row.response_status, bodyText: row.response_body } };
    }
    return { kind: 'claimed' };
  }
  return { kind: 'reused' };
}

async function storeResponse(
  client: PoolClient,
  accountId: string,
  key: string,
  response: StoredResponse,
): Promise<void> {
  await query(
    client,
    `update idempotency_keys set response_status = $3, response_body = $4
      where account_id = $1 and key = $2`,
    [accountId, key, response.status, response.bodyText],
  );
}

async function holdOutcome(
  client: PoolClient,
  account: AccountRecord,
  body: JsonBody,
): Promise<StoredResponse> {
  await client.query('SAVEPOINT hold_attempt');
  try {
    requireRole(account, 'buyer');
    const unitCodeValue = body.value.unitCode;
    if (typeof unitCodeValue === 'string') {
      const unit = await loadUnit(client, unitCodeValue);
      if (!unit || !isVisibleToBuyers(unit.status)) throw new ApiError('not_found');
    } else {
      throw new ApiError('invalid', { fields: { unitCode: FIELD_MESSAGES.unitCode } });
    }
    const priceVersion = readIntegerField(body, {
      field: 'priceVersion',
      message: FIELD_MESSAGES.priceVersion,
      min: 1,
    });
    const hold = await placeHold(client, {
      accountId: account.id,
      unitCode: unitCodeValue,
      priceVersion,
    });
    return { status: 201, bodyText: JSON.stringify({ hold }) };
  } catch (error) {
    if (error instanceof ApiError) {
      await client.query('ROLLBACK TO SAVEPOINT hold_attempt');
      return { status: error.status, bodyText: JSON.stringify(error.body()) };
    }
    throw error;
  }
}

export async function createHold(wire: Wire, body: JsonBody): Promise<void> {
  const account = await requireAccount(wire);
  const key = readIdempotencyKey(wire);
  if (key !== null) assertIdempotencyKeyShape(key);
  const unitCodeValue = body.value.unitCode;
  const unitCode = typeof unitCodeValue === 'string' ? unitCodeValue : null;
  const priceVersionToken = rawFieldToken(body.raw, 'priceVersion');
  const priceVersion =
    priceVersionToken !== null && /^[0-9]+$/.test(priceVersionToken) ? Number(priceVersionToken) : null;

  try {
    const response = await withTransaction(async (client) => {
      if (key !== null) {
        const claim = await claimIdempotencyKey(client, account.id, key, unitCode, priceVersion);
        if (claim.kind === 'replay') return claim.response;
        if (claim.kind === 'reused') {
          const reused = new ApiError('idempotency_key_reused');
          return { status: reused.status, bodyText: JSON.stringify(reused.body()) };
        }
      }
      const attempt = await countHoldAttempt(client, account.id);
      if (attempt.refused) throw new AttemptsExhausted(attempt.retryAfterSeconds);
      const outcome = await holdOutcome(client, account, body);
      if (key !== null) await storeResponse(client, account.id, key, outcome);
      return outcome;
    });
    sendText(wire, response.status, response.bodyText, 'application/json; charset=utf-8');
  } catch (error) {
    if (error instanceof AttemptsExhausted) {
      throw new ApiError('hold_attempts', {
        retryAfterSeconds: error.retryAfterSeconds,
        placeholders: { seconds: String(error.retryAfterSeconds) },
      });
    }
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id that cannot name a hold answers exactly like a hold that never existed. */
function assertHoldId(holdId: string): string {
  if (!UUID.test(holdId)) throw new ApiError('not_found');
  return holdId;
}

export async function listHolds(wire: Wire): Promise<void> {
  const account = requireRole(await requireAccount(wire), 'buyer');
  await applyLapseCheck(pool);
  const rows = await holdsForAccount(pool, account.id);
  sendJson(wire, 200, { holds: rows.map(publicHold) });
}

export async function readHold(wire: Wire, holdId: string): Promise<void> {
  const account = requireRole(await requireAccount(wire), 'buyer');
  await applyLapseCheck(pool);
  const row = await loadHoldForAccount(pool, assertHoldId(holdId), account.id);
  if (!row) throw new ApiError('not_found');
  sendJson(wire, 200, { hold: publicHold(row) });
}

export async function release(wire: Wire, holdId: string): Promise<void> {
  const account = requireRole(await requireAccount(wire), 'buyer');
  sendJson(wire, 200, { hold: await releaseHold(assertHoldId(holdId), account.id) });
}

export async function share(wire: Wire, holdId: string): Promise<void> {
  const account = requireRole(await requireAccount(wire), 'buyer');
  sendJson(wire, 201, { shareUrl: await createShareLink(assertHoldId(holdId), account.id) });
}

export async function revokeShare(wire: Wire, holdId: string): Promise<void> {
  const account = requireRole(await requireAccount(wire), 'buyer');
  await revokeShareLink(assertHoldId(holdId), account.id);
  sendEmpty(wire, 204);
}
