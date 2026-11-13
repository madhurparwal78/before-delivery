import type { Queryable } from '../db/pool.js';
import { newTrackingToken, tokenDigest } from './candidate.js';

/** Mints the one live tracking link for an application and retires any earlier one. */
export async function issueTrackingToken(
  tx: Queryable,
  applicationId: string,
): Promise<string> {
  await tx.query(
    `UPDATE tracking_links SET retired_at = now()
      WHERE application_id = $1 AND retired_at IS NULL`,
    [applicationId],
  );
  const token = newTrackingToken();
  await tx.query(
    `INSERT INTO tracking_links (token_digest, token, application_id, created_at)
     VALUES ($1,$2,$3,now())`,
    [tokenDigest(token), token, applicationId],
  );
  return token;
}

/** The live capability for an application, or null once every link has been retired. */
export async function liveTrackingToken(
  tx: Queryable,
  applicationId: string,
): Promise<string | null> {
  const result = await tx.query<{ token: string }>(
    'SELECT token FROM tracking_links WHERE application_id = $1 AND retired_at IS NULL',
    [applicationId],
  );
  return result.rows[0]?.token ?? null;
}
