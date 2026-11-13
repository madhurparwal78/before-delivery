import { createHash } from 'node:crypto';
import { query } from './db/pool';
import { ApiError } from './errors';
import { Reply } from './http';

const STORED_STATUSES = [201, 402, 409, 422];
const WAIT_STEP_MS = 40;
const MAX_WAITS = 400;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(source[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function fingerprintOf(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method}\n${path}\n${stable(body)}`).digest('hex');
}

interface StoredRecord {
  fingerprint: string;
  status: number | null;
  body: string | null;
}

async function readRecord(makerId: string, key: string): Promise<StoredRecord | null> {
  const found = await query<StoredRecord>(
    'SELECT fingerprint, status, body FROM idempotency_records WHERE maker_id = $1 AND key = $2',
    [makerId, key]
  );
  return found[0] ?? null;
}

async function store(makerId: string, key: string, status: number, body: string): Promise<void> {
  await query('UPDATE idempotency_records SET status = $3, body = $4 WHERE maker_id = $1 AND key = $2', [
    makerId,
    key,
    status,
    body
  ]);
}

async function drop(makerId: string, key: string): Promise<void> {
  await query('DELETE FROM idempotency_records WHERE maker_id = $1 AND key = $2', [makerId, key]);
}

function replayOf(record: StoredRecord): Reply {
  return { status: record.status ?? 200, rawJson: record.body ?? 'null' };
}

function bodyText(reply: Reply): string {
  if (reply.rawJson !== undefined) return reply.rawJson;
  return JSON.stringify(reply.json ?? null);
}

/**
 * Runs a hold or purchase once per idempotency key. The same key with the same request
 * replays the stored response; a different request answers `idempotency_conflict`.
 */
export async function withIdempotency(
  makerId: string,
  key: string,
  fingerprint: string,
  work: () => Promise<Reply>
): Promise<Reply> {
  for (let attempt = 0; attempt < MAX_WAITS; attempt += 1) {
    const claimed = await query<{ key: string }>(
      `INSERT INTO idempotency_records (maker_id, key, fingerprint) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING key`,
      [makerId, key, fingerprint]
    );
    if (claimed[0] !== undefined) {
      try {
        const reply = await work();
        await store(makerId, key, reply.status, bodyText(reply));
        return reply;
      } catch (error) {
        if (error instanceof ApiError && STORED_STATUSES.includes(error.status)) {
          await store(makerId, key, error.status, JSON.stringify(error.body()));
        } else {
          await drop(makerId, key);
        }
        throw error;
      }
    }
    const record = await readRecord(makerId, key);
    if (record === null) continue;
    if (record.fingerprint !== fingerprint) throw new ApiError('idempotency_conflict');
    if (record.status !== null) return replayOf(record);
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
  throw new ApiError('idempotency_conflict');
}
