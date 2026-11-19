import { config, pacingPolicyKey } from '../config.ts';
import type { Queryable } from '../db/pool.ts';

export type PacingDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Counted = { used: string; oldest: Date | null };

async function countWithin(
  client: Queryable,
  column: 'sender_key' | 'ip_key',
  value: string,
): Promise<Counted> {
  const result = await client.query<Counted>(
    `SELECT count(*)::text AS used, min(received_at) AS oldest
       FROM enquiries
      WHERE ${column} = $1 AND pacing_policy = $2
        AND received_at > now() - make_interval(secs => $3::double precision)`,
    [value, pacingPolicyKey, config.pacing.windowSeconds],
  );
  return result.rows[0] as Counted;
}

function retryAfter(oldest: Date | null, now: Date): number {
  if (oldest === null) return 1;
  const leaves = oldest.getTime() + config.pacing.windowSeconds * 1000;
  return Math.max(1, Math.ceil((leaves - now.getTime()) / 1000));
}

/** Counts only enquiries saved under this instance's pacing policy. */
export async function checkPacing(
  client: Queryable,
  input: { senderKey: string; ipKey: string; now: Date },
): Promise<PacingDecision> {
  const sender = await countWithin(client, 'sender_key', input.senderKey);
  if (Number(sender.used) >= config.pacing.perSender) {
    return { allowed: false, retryAfterSeconds: retryAfter(sender.oldest, input.now) };
  }
  const ip = await countWithin(client, 'ip_key', input.ipKey);
  if (Number(ip.used) >= config.pacing.perIp) {
    return { allowed: false, retryAfterSeconds: retryAfter(ip.oldest, input.now) };
  }
  return { allowed: true };
}

/** Pacing checks for one sender or one IP are taken one at a time across every instance. */
export async function lockPacing(client: Queryable, senderKey: string, ipKey: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('enquiry-sender'), hashtext($1))`, [senderKey]);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('enquiry-ip'), hashtext($1))`, [ipKey]);
}
