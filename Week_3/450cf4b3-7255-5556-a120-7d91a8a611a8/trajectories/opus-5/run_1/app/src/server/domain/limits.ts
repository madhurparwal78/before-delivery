import { config } from '../config';
import { pool, query, queryOne, withTransaction, type Db } from '../db';

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SigninLimit {
  limited: boolean;
  retryAfterSeconds: number;
}

/** The sign-in limit, counted in Postgres and shared by every app process. */
export async function signinLimitFor(client: Db, email: string): Promise<SigninLimit> {
  const row = await queryOne<{ failures: string; oldest: Date | null }>(
    client,
    `with last_success as (
       select coalesce(max(created_at), to_timestamp(0)) as at
       from signin_attempts where email = $1 and outcome = 'success'
     )
     select count(*)::text as failures, min(created_at) as oldest
     from signin_attempts, last_success
     where email = $1 and outcome = 'failure'
       and created_at > now() - make_interval(secs => $2::double precision)
       and created_at > last_success.at`,
    [email, config.signinWindowSeconds],
  );
  const failures = Number(row?.failures ?? '0');
  if (failures < 5 || row === null || row.oldest === null) {
    return { limited: false, retryAfterSeconds: 0 };
  }
  const leavesAt = row.oldest.getTime() + config.signinWindowSeconds * 1000;
  const seconds = Math.ceil((leavesAt - Date.now()) / 1000);
  return {
    limited: true,
    retryAfterSeconds: Math.min(config.signinWindowSeconds, Math.max(1, seconds)),
  };
}

/** Attempts are committed on their own, so a refused sign-in still counts. */
export async function recordSigninAttempt(
  email: string,
  outcome: 'failure' | 'success',
): Promise<void> {
  await pool.query('insert into signin_attempts (email, outcome) values ($1,$2)', [email, outcome]);
}

export interface ClaimLimit {
  limited: boolean;
  retryAfterSeconds: number;
}

/** Counts a claim and refuses it past 10 in any rolling 60 seconds, in its own transaction. */
export async function countClaim(tenantId: string): Promise<ClaimLimit> {
  return withTransaction(async (client) => {
    await query(client, 'select pg_advisory_xact_lock(hashtext($1))', [`claim-limit:${tenantId}`]);
    const row = await queryOne<{ counted: string; oldest: Date | null }>(
      client,
      `select count(*)::text as counted, min(created_at) as oldest from counted_claims
       where tenant_id = $1 and created_at > now() - interval '60 seconds'`,
      [tenantId],
    );
    const counted = Number(row?.counted ?? '0');
    if (counted >= 10 && row !== null && row.oldest !== null) {
      const leavesAt = row.oldest.getTime() + 60_000;
      const seconds = Math.ceil((leavesAt - Date.now()) / 1000);
      return { limited: true, retryAfterSeconds: Math.min(60, Math.max(1, seconds)) };
    }
    await query(client, 'insert into counted_claims (tenant_id) values ($1)', [tenantId]);
    return { limited: false, retryAfterSeconds: 0 };
  });
}
