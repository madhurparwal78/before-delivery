import crypto from 'node:crypto';
import { connectDb, withTx, type Tx, type Row } from '../db.js';
import { config } from '../config.js';
import { now } from '../time.js';
import { vetHeaders } from '../rate.js';
import { tokenHash } from '../apitokens.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Caller } from '../context.js';
import { send } from '../respond.js';
import { AppError } from '../errors.js';

/** Vet-link guess limit: 10 misses per address in a rolling 60s (DP-54). */
export async function vetGuessCheck(address: string): Promise<{ limited: boolean; retryAfter: number; headers: Record<string, string> }> {
  const t = now();
  return withTx(async (tx: Tx) => {
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`vetmiss:${address}`]);
    await tx.query(`delete from vet_misses where at <= $1::timestamptz - interval '60 seconds'`, [t]);
    const rows = await tx.query(`select count(*)::int as n from vet_misses where address = $1`, [address]);
    const headers = vetHeaders();
    if (rows[0].n >= 10) {
      const oldest = await tx.query(`select min(at) as m from vet_misses where address = $1`, [address]);
      const until = oldest[0].m ? Math.ceil((oldest[0].m.getTime() + 60000 - t.getTime()) / 1000) : 1;
      return { limited: true, retryAfter: Math.max(1, until), headers };
    }
    return { limited: false, retryAfter: 0, headers };
  });
}

export async function recordVetMiss(address: string): Promise<void> {
  await withTx(async (tx: Tx) => {
    await tx.query(`insert into vet_misses(address, at) values($1,$2)`, [address, now()]);
  });
}

export async function addressVetAllowance(address: string): Promise<{ allowed: boolean; retryAfter: number; headers: Record<string, string> }> {
  const { consume } = await import('../rate.js');
  const r = await consume(null, 'VET', [{ scope: 'address', key: address }]);
  return { allowed: r.ok, retryAfter: r.retryAfter, headers: r.headers };
}

/** GET /api/vet/{token}: the read-only comparison (DP-37, DP-100, DP-38). */
export async function serveVetToken(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string,
  address: string,
  caller: Caller | null
): Promise<number> {
  const token = url.pathname.slice('/api/vet/'.length);
  const hash = tokenHash(token);
  const rows = await connectDb().query(`select * from vet_links where token_hash = $1`, [hash]);
  const link = rows.rows[0] ?? null;
  const t = now();
  const userAgent = String(req.headers['user-agent'] ?? '');

  let outcome: 'viewed' | 'expired' | 'revoked' | null = null;
  let pair: Row[] = [];
  if (link) {
    if (link.status === 'revoked') outcome = 'revoked';
    else if (link.expires_at.getTime() <= t.getTime()) outcome = 'expired';
    else {
      outcome = 'viewed';
      pair = (await connectDb().query(
        `select v.id, v.business_date from visits v where v.horse_id = $1 and v.status <> 'open'
         order by v.business_date desc, v.created_at desc limit 2`,
        [link.horse_id]
      )).rows;
    }
    // The address allowance applies to every vet read that reaches this step.
    const allowance = await addressVetAllowance(address);
    if (!allowance.allowed) {
      send(res, requestId, 429, { error: 'rate_limited' }, { 'Retry-After': String(allowance.retryAfter), ...allowance.headers });
      return 429;
    }
    await withTx(async (tx: Tx) => {
      await tx.query(
        `insert into vet_views(id, vet_link_id, at, address, outcome, user_agent, previous_date, pair_current_date)
         values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newId('view'), link.id, t, address, outcome, userAgent,
         outcome === 'viewed' && pair.length === 2 ? pair[1].business_date : null,
         outcome === 'viewed' && pair.length === 2 ? pair[0].business_date : null]
      );
    });
  }

  if (!link || !outcome || outcome !== 'viewed' || pair.length < 2) {
    if (!link) await recordVetMiss(address);
    throw new AppError(404, 'not_found');
  }

  const { buildVetComparison } = await import('./vetview.js');
  const body = await buildVetComparison(link, pair, requestId);
  send(res, requestId, 200, body);
  return 200;
}

function newId(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(12).toString('hex');
}
