import { config } from './config';
import { transaction } from './db';
import { ApiError, type Version } from './errors';
import { reserve, type Created, type SeatCounts } from './booking';

// Retried reservations. A key belongs to one account; it is recorded only with a successful
// reservation, in the same transaction, and replays that exact body on the same session and
// version until it expires. A second request holding the same key at once is told to wait.

const VISIBLE_ASCII_MIN = 0x21;
const VISIBLE_ASCII_MAX = 0x7e;

// The Idempotency-Key header: 1 to 255 visible ASCII characters, or absent.
export function idempotencyKey(header: string | string[] | undefined): string | null {
  if (header === undefined) return null;
  const key = Array.isArray(header) ? header.join(',') : header;
  const visible = Array.from(key).every((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= VISIBLE_ASCII_MIN && code <= VISIBLE_ASCII_MAX;
  });
  if (key.length < 1 || key.length > 255 || !visible) throw new ApiError('invalid');
  return key;
}

interface StoredKey {
  version: Version;
  session_id: string;
  response_body: string;
  fresh: boolean;
}

export async function reserveOnce(
  accountId: string,
  sessionId: string,
  version: Version,
  key: string | null,
  render: (created: Created, seats: SeatCounts) => unknown,
): Promise<string> {
  return transaction(async (tx) => {
    if (key !== null) {
      const lock = await tx.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0)) AS locked",
        [accountId, key],
      );
      if (lock.rows[0]?.locked !== true) throw new ApiError('request_in_progress');
      const stored = await tx.query<StoredKey>(
        `SELECT version, session_id, response_body,
                created_at + make_interval(secs => $3) > clock_timestamp() AS fresh
           FROM idempotency_keys WHERE account_id = $1 AND key = $2`,
        [accountId, key, config.idempotencyKeyTtlSeconds],
      );
      const previous = stored.rows[0];
      if (previous?.fresh === true) {
        if (previous.session_id === sessionId && previous.version === version) return previous.response_body;
        throw new ApiError('idempotency_key_reused');
      }
      if (previous !== undefined) await tx.query('DELETE FROM idempotency_keys WHERE account_id = $1 AND key = $2', [accountId, key]);
    }
    const { created, seats } = await reserve(tx, accountId, sessionId);
    const body = JSON.stringify(render(created, seats));
    if (key !== null) {
      await tx.query(
        'INSERT INTO idempotency_keys (account_id, key, version, session_id, response_body) VALUES ($1, $2, $3, $4, $5)',
        [accountId, key, version, sessionId, body],
      );
    }
    return body;
  });
}
