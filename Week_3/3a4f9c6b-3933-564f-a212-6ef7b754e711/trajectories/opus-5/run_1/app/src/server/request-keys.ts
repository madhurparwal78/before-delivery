import { createHash } from 'node:crypto';
import { config } from './config.js';
import { isUniqueViolation, query, queryOne } from './db.js';
import { errors } from './errors.js';

const KEY_FORMAT = /^[\x21-\x7e]{1,200}$/;
const WAIT_STEP_MS = 100;
const WAIT_STEPS = 100;

export function readRequestKey(header: string | undefined): string {
  if (header === undefined || !KEY_FORMAT.test(header)) throw errors.requestKeyRequired();
  return header;
}

/** Key order and whitespace must not change what counts as the same body. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(body)) ?? 'null').digest('hex');
}

export interface KeyedReply {
  status: number;
  body: unknown;
}

interface StoredKey {
  body_hash: string;
  status: number | null;
  response_body: unknown;
  completed: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a keyed call once. A repeat with an equal body replays the stored response, a repeat with
 * a different body is refused, and a 503 is never stored so the retry runs afresh.
 */
export async function withRequestKey(
  personId: string,
  method: string,
  path: string,
  key: string,
  body: unknown,
  run: () => Promise<KeyedReply>,
): Promise<{ reply: KeyedReply; replayed: boolean }> {
  const hash = bodyHash(body);

  for (;;) {
    try {
      await query(
        `INSERT INTO request_keys
           (person_id, method, path, request_key, body_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, now(), now() + ($6 || ' seconds')::interval)`,
        [personId, method, path, key, hash, String(config.requestKeyTtlSeconds)],
      );
      break;
    } catch (cause) {
      if (!isUniqueViolation(cause)) throw cause;
      const existing = await waitForStored(personId, method, path, key, hash);
      if (existing) return { reply: existing, replayed: true };
      // The stored response fell out of the window, so the key is free again.
    }
  }

  let reply: KeyedReply;
  try {
    reply = await run();
  } catch (cause) {
    await forget(personId, method, path, key);
    throw cause;
  }

  // A 503 is never stored, so a retry with the same key runs afresh.
  if (reply.status >= 500) {
    await forget(personId, method, path, key);
    return { reply, replayed: false };
  }

  await query(
    `UPDATE request_keys SET status = $5, response_body = $6, completed = true
     WHERE person_id = $1 AND method = $2 AND path = $3 AND request_key = $4`,
    [personId, method, path, key, reply.status, JSON.stringify(reply.body)],
  );
  return { reply, replayed: false };
}

async function waitForStored(
  personId: string,
  method: string,
  path: string,
  key: string,
  hash: string,
): Promise<KeyedReply | null> {
  for (let step = 0; step < WAIT_STEPS; step += 1) {
    const row = await queryOne<StoredKey>(
      `SELECT body_hash, status, response_body, completed FROM request_keys
       WHERE person_id = $1 AND method = $2 AND path = $3 AND request_key = $4
         AND expires_at > now()`,
      [personId, method, path, key],
    );
    if (!row) return null;
    if (row.body_hash !== hash) throw errors.requestKeyReused();
    if (row.completed && row.status !== null) return { status: row.status, body: row.response_body };
    await sleep(WAIT_STEP_MS);
  }
  throw new Error(`Request key ${key} is still running after ${(WAIT_STEPS * WAIT_STEP_MS) / 1000}s`);
}

async function forget(personId: string, method: string, path: string, key: string): Promise<void> {
  await query(
    `DELETE FROM request_keys
     WHERE person_id = $1 AND method = $2 AND path = $3 AND request_key = $4 AND NOT completed`,
    [personId, method, path, key],
  );
}

export async function purgeExpiredKeys(): Promise<void> {
  await query('DELETE FROM request_keys WHERE expires_at < now()');
  await query('DELETE FROM sessions WHERE expires_at < now()');
}
