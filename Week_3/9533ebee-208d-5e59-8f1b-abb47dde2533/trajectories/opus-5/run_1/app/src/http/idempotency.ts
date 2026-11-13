/**
 * Idempotency-Key semantics. Keys are scoped to the acting member and the
 * endpoint path and kept permanently. The first response with a status below
 * 500 is stored with a fingerprint of the canonical body, so a replay returns
 * it and moves nothing, and the same key with a different body is refused.
 */

import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction, writeInstant } from '../db/pool.ts';
import { canonicalJson } from './boundary.ts';
import { idempotencyKeyRequired, idempotencyKeyReused, isProblem, Problem } from './problem.ts';

/** A key of 1 to 128 visible ASCII characters. */
const VISIBLE_ASCII = /^[\x21-\x7E]{1,128}$/;

export function readIdempotencyKey(header: string | string[] | undefined): string {
  if (typeof header !== 'string' || !VISIBLE_ASCII.test(header)) {
    throw idempotencyKeyRequired();
  }
  return header;
}

function fingerprintOf(body: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

interface StoredRow {
  fingerprint: string;
  status: number;
  body: string;
}

async function storedReply(
  actorId: string,
  path: string,
  key: string,
): Promise<StoredRow | null> {
  const result = await query<StoredRow>(
    'SELECT fingerprint, status, body FROM idempotency_keys WHERE actor_id = $1 AND path = $2 AND key = $3',
    [actorId, path, key],
  );
  return result.rows[0] ?? null;
}

async function remember(
  client: Pick<PoolClient, 'query'>,
  actorId: string,
  path: string,
  key: string,
  fingerprint: string,
  status: number,
  body: string,
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_keys (actor_id, path, key, fingerprint, status, body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId, path, key, fingerprint, status, body, writeInstant(Date.now())],
  );
}

export interface KeyedOutcome {
  readonly status: number;
  /** The response as its exact JSON text. */
  readonly bodyText: string;
  readonly replayed: boolean;
}

/**
 * The stored reply for this key, or null when the key is unused. Consulted at
 * its own rung of the error ladder, before unknown resources and roles.
 */
export async function checkReplay(
  actorId: string,
  path: string,
  key: string,
  body: Readonly<Record<string, unknown>>,
): Promise<KeyedOutcome | null> {
  const existing = await storedReply(actorId, path, key);
  if (existing === null) return null;
  if (existing.fingerprint !== fingerprintOf(body)) throw idempotencyKeyReused();
  return { status: existing.status, bodyText: existing.body, replayed: true };
}

/**
 * Runs a keyed money movement exactly once.
 *
 * The claim is inserted in the same transaction as the work, so a rolled-back
 * attempt leaves no key behind and a retry after a 5xx runs fresh. Two
 * requests with the same key arriving together are serialised by the primary
 * key: the second blocks on the insert until the first transaction finishes,
 * then returns the stored reply.
 */
export async function runKeyed(
  actorId: string,
  path: string,
  key: string,
  body: Readonly<Record<string, unknown>>,
  work: (client: PoolClient) => Promise<{ status: number; body: unknown }>,
): Promise<KeyedOutcome> {
  const fingerprint = fingerprintOf(body);

  const replay = await checkReplay(actorId, path, key, body);
  if (replay !== null) return replay;

  try {
    return await transaction(async (client) => {
      await remember(client, actorId, path, key, fingerprint, 0, '');
      const result = await work(client);
      const bodyText = JSON.stringify(result.body);
      await client.query(
        'UPDATE idempotency_keys SET status = $1, body = $2 WHERE actor_id = $3 AND path = $4 AND key = $5',
        [result.status, bodyText, actorId, path, key],
      );
      return { status: result.status, bodyText, replayed: false };
    });
  } catch (error) {
    // The key was taken while this request waited on the insert.
    if (isUniqueViolation(error)) {
      const stored = await storedReply(actorId, path, key);
      if (stored !== null) {
        if (stored.fingerprint !== fingerprint) throw idempotencyKeyReused();
        return { status: stored.status, bodyText: stored.body, replayed: true };
      }
      throw error;
    }
    // A refusal below 500 is an answer: it is stored, and it moved nothing
    // because the transaction that would have moved it rolled back.
    if (isProblem(error) && error.status < 500) {
      await storeProblem(actorId, path, key, fingerprint, error);
      throw error;
    }
    throw error;
  }
}

async function storeProblem(
  actorId: string,
  path: string,
  key: string,
  fingerprint: string,
  problem: Problem,
): Promise<void> {
  try {
    await transaction(async (client) => {
      await remember(
        client,
        actorId,
        path,
        key,
        fingerprint,
        problem.status,
        JSON.stringify(problem.body()),
      );
    });
  } catch (error) {
    // Another attempt with this key stored its own answer first; that answer
    // stands and this one is simply reported to its caller.
    if (!isUniqueViolation(error)) throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}
