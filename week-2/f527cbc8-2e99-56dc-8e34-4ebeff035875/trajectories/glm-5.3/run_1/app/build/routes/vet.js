import crypto from 'node:crypto';
import { connectDb, withTx } from '../db.js';
import { now } from '../time.js';
import { vetHeaders } from '../rate.js';
import { tokenHash } from '../apitokens.js';
import { send } from '../respond.js';
import { AppError } from '../errors.js';
export async function vetGuessCheck(address) {
    const t = now();
    return withTx(async (tx) => {
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
export async function recordVetMiss(address) {
    await withTx(async (tx) => {
        await tx.query(`insert into vet_misses(address, at) values($1,$2)`, [address, now()]);
    });
}
export async function addressVetAllowance(address) {
    const { consume } = await import('../rate.js');
    const r = await consume(null, 'VET', [{ scope: 'address', key: address }]);
    return { allowed: r.ok, retryAfter: r.retryAfter, headers: r.headers };
}
export async function serveVetToken(req, res, url, requestId, address, caller) {
    const token = url.pathname.slice('/api/vet/'.length);
    const hash = tokenHash(token);
    const rows = await connectDb().query(`select * from vet_links where token_hash = $1`, [hash]);
    const link = rows.rows[0] ?? null;
    const t = now();
    const userAgent = String(req.headers['user-agent'] ?? '');
    let outcome = null;
    let pair = [];
    if (link) {
        if (link.status === 'revoked')
            outcome = 'revoked';
        else if (link.expires_at.getTime() <= t.getTime())
            outcome = 'expired';
        else {
            outcome = 'viewed';
            pair = (await connectDb().query(`select v.id, v.business_date from visits v where v.horse_id = $1 and v.status <> 'open'
         order by v.business_date desc, v.created_at desc limit 2`, [link.horse_id])).rows;
        }
        const allowance = await addressVetAllowance(address);
        if (!allowance.allowed) {
            send(res, requestId, 429, { error: 'rate_limited' }, { 'Retry-After': String(allowance.retryAfter), ...allowance.headers });
            return 429;
        }
        await withTx(async (tx) => {
            await tx.query(`insert into vet_views(id, vet_link_id, at, address, outcome, user_agent, previous_date, pair_current_date)
         values($1,$2,$3,$4,$5,$6,$7,$8)`, [newId('view'), link.id, t, address, outcome, userAgent,
                outcome === 'viewed' && pair.length === 2 ? pair[1].business_date : null,
                outcome === 'viewed' && pair.length === 2 ? pair[0].business_date : null]);
        });
    }
    if (!link || !outcome || outcome !== 'viewed' || pair.length < 2) {
        if (!link)
            await recordVetMiss(address);
        throw new AppError(404, 'not_found');
    }
    const { buildVetComparison } = await import('./vetview.js');
    const body = await buildVetComparison(link, pair, requestId);
    send(res, requestId, 200, body);
    return 200;
}
function newId(prefix) {
    return prefix + '_' + crypto.randomBytes(12).toString('hex');
}
