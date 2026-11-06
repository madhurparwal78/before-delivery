import { query, queryOne } from '../db';
import { bodyHash } from '../secrets';
import { apiErrors } from '../http/errors';

const NO_SCOPE = '00000000-0000-0000-0000-000000000000';
const KEY_RE = /^[\x20-\x7e]{8,128}$/;

export interface StoredResponse {
  status: number;
  text: string;
}

interface KeyRow {
  body_hash: string;
  status: number | null;
  response: string | null;
}

/**
 * Runs `work` at most once per request key. A replay with the same body returns the stored
 * response byte for byte; a replay with a different body is refused.
 */
export function requireRequestKey(key: string | undefined): string {
  if (!key || !KEY_RE.test(key)) throw apiErrors.badIdempotencyKey();
  return key;
}

export async function withRequestKey(
  scope: { memberId: string; endpoint: string; workbookId?: string; key: string | undefined; body: Buffer },
  work: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  const key = requireRequestKey(scope.key);
  const scopeId = scope.workbookId ?? NO_SCOPE;
  const hash = bodyHash(scope.body);
  const inserted = await query<{ key: string }>(
    `insert into request_keys (member_id, endpoint, scope_id, key, body_hash)
     values ($1,$2,$3,$4,$5)
     on conflict (member_id, endpoint, scope_id, key) do nothing
     returning key`,
    [scope.memberId, scope.endpoint, scopeId, key, hash],
  );
  if (inserted.length === 0) {
    const replay = await waitForStoredResponse(scope.memberId, scope.endpoint, scopeId, key, hash);
    if (replay) return replay;
    await query(
      `update request_keys set body_hash = $5, status = null, response = null
       where member_id = $1 and endpoint = $2 and scope_id = $3 and key = $4`,
      [scope.memberId, scope.endpoint, scopeId, key, hash],
    );
  }
  try {
    const result = await work();
    await query(
      `update request_keys set status = $5, response = $6
       where member_id = $1 and endpoint = $2 and scope_id = $3 and key = $4`,
      [scope.memberId, scope.endpoint, scopeId, key, result.status, result.text],
    );
    return result;
  } catch (failure) {
    await query(
      'delete from request_keys where member_id = $1 and endpoint = $2 and scope_id = $3 and key = $4',
      [scope.memberId, scope.endpoint, scopeId, key],
    );
    throw failure;
  }
}

async function waitForStoredResponse(
  memberId: string,
  endpoint: string,
  scopeId: string,
  key: string,
  hash: string,
): Promise<StoredResponse | null> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = await queryOne<KeyRow>(
      `select body_hash, status, response from request_keys
       where member_id = $1 and endpoint = $2 and scope_id = $3 and key = $4`,
      [memberId, endpoint, scopeId, key],
    );
    if (!row) return null;
    if (row.body_hash !== hash) throw apiErrors.idempotencyKeyReused();
    if (row.status !== null && row.response !== null) return { status: row.status, text: row.response };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}
