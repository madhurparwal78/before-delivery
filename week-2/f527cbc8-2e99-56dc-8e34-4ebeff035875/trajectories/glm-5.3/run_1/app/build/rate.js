import { connectDb } from './db.js';
import { config } from './config.js';
import { now } from './time.js';
const SALT = 'clinchline-static-salt-v1';
export async function consume(tx, bucket, entries) {
    const q = tx ? tx.query.bind(tx) : ((sql, p) => connectDb().query(sql, p).then((r) => r.rows));
    const t = now();
    const results = [];
    for (const e of entries) {
        const conf = config.rate[`${bucket}.${e.scope}`];
        if (!conf)
            continue;
        const rows = await q(`insert into rate_rows(bucket, scope, key, tokens, updated_at)
       values($1,$2,$3,$4,$5)
       on conflict(bucket, scope, key) do update set
         tokens = least(rate_rows.tokens + extract(epoch from ($5::timestamptz - rate_rows.updated_at)) * ($6::float8 / 60.0), $4::float8),
         updated_at = greatest(rate_rows.updated_at, $5)
       returning tokens, updated_at`, [bucket, e.scope, e.key, conf.capacity, t, conf.refillPerMinute]);
        const storedUpdated = new Date(rows[0].updated_at);
        results.push({ scope: e.scope, key: e.key, tokens: rows[0].tokens, updated: storedUpdated, conf });
    }
    let refusing = null;
    const updated = [];
    for (const r of results) {
        if (r.tokens < 1) {
            if (!refusing)
                refusing = { scope: r.scope, key: r.key };
            updated.push(r);
        }
        else {
            const rows = await q(`update rate_rows set tokens = tokens - 1 where bucket=$1 and scope=$2 and key=$3 returning tokens`, [bucket, r.scope, r.key]);
            updated.push({ ...r, tokens: rows[0].tokens });
        }
    }
    const report = updated.map(r => ({
        r,
        remaining: Math.max(0, Math.floor(r.tokens)),
        resetSec: Math.ceil(Math.max(0, (r.conf.capacity - r.tokens) * 60 / r.conf.refillPerMinute) + Math.max(0, (r.updated.getTime() - t.getTime()) / 1000)),
        retryAfter: Math.max(1, Math.ceil((1 - r.tokens) * 60 / r.conf.refillPerMinute + Math.max(0, (r.updated.getTime() - t.getTime()) / 1000)))
    }));
    let chosen = report[0];
    for (const p of report) {
        if (p.r.tokens < chosen.r.tokens || (p.r.tokens === chosen.r.tokens && p.r.scope === 'user'))
            chosen = p;
    }
    const refusingReport = refusing ? report.find(p => p.r.scope === refusing.scope && p.r.key === refusing.key) : undefined;
    const finalPick = refusingReport ?? chosen;
    const headers = {
        'RateLimit-Limit': String(finalPick.r.conf.capacity),
        'RateLimit-Remaining': String(finalPick.remaining),
        'RateLimit-Reset': String(finalPick.resetSec)
    };
    if (refusing) {
        return { ok: false, retryAfter: refusingReport.retryAfter, headers, refusing };
    }
    return { ok: true, retryAfter: 0, headers };
}
export function vetHeaders() {
    const conf = config.rate['VET.address'];
    return {
        'RateLimit-Limit': String(conf.capacity),
        'RateLimit-Remaining': String(conf.capacity - 1),
        'RateLimit-Reset': String(Math.ceil(60 / conf.refillPerMinute))
    };
}
