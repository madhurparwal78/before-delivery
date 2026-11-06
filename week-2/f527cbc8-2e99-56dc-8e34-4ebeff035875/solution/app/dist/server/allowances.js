// Request allowances and the vet-link guess limit, decided here and nowhere else. Each allowance's tokens live in
// one shared Postgres row; its capacity and refill come from the environment of the instance handling the request
// (brief: Business rules, Request allowances; Vet-link guess limit; Instances and the clock).
import { config } from "./config.js";
import { db, first, transaction } from "./db.js";
/** Takes one token from the allowance when one exists; a refused request takes nothing. */
export async function takeToken(bucket, scope, key, at) {
    const size = config.allowances[bucket][scope];
    if (!size)
        return null;
    return transaction(async (client) => {
        await client.query(`INSERT INTO allowances (bucket, scope, key, tokens, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bucket, scope, key) DO NOTHING`, [bucket, scope, key, size.capacity, new Date(at)]);
        const row = first((await client.query(`SELECT tokens, updated_at FROM allowances WHERE bucket = $1 AND scope = $2 AND key = $3 FOR UPDATE`, [bucket, scope, key])).rows);
        const elapsed = Math.max(0, at - row.updated_at.getTime()) / 1000;
        const refilled = Math.min(size.capacity, row.tokens + (elapsed * size.refillPerMinute) / 60);
        const allowed = refilled >= 1;
        const tokens = allowed ? refilled - 1 : refilled;
        await client.query(`UPDATE allowances SET tokens = $4, updated_at = $5 WHERE bucket = $1 AND scope = $2 AND key = $3`, [
            bucket,
            scope,
            key,
            tokens,
            new Date(Math.max(at, row.updated_at.getTime())),
        ]);
        const leadSeconds = Math.max(0, row.updated_at.getTime() - at) / 1000;
        return { bucket, scope, capacity: size.capacity, refillPerMinute: size.refillPerMinute, tokens, leadSeconds, allowed };
    });
}
const perSecond = (state) => state.refillPerMinute / 60;
/** Whole seconds, rounded up and at least 1, until one token exists again, including the stored instant's lead. */
const retryAfterSeconds = (state) => Math.max(1, Math.ceil((1 - state.tokens) / perSecond(state) + state.leadSeconds));
/**
 * RateLimit headers describing the reached allowance with fewer tokens remaining (a tie reports the user
 * allowance), or the refusing allowance on a 429.
 */
export function rateLimitHeaders(reached) {
    if (!reached.length)
        return {};
    const refused = reached.find((state) => !state.allowed);
    const shown = refused ??
        reached.reduce((best, state) => {
            const fewer = Math.floor(state.tokens) < Math.floor(best.tokens);
            const tieToUser = Math.floor(state.tokens) === Math.floor(best.tokens) && state.scope === "user";
            return fewer || tieToUser ? state : best;
        });
    const headers = {
        "ratelimit-limit": String(shown.capacity),
        "ratelimit-remaining": String(Math.max(0, Math.floor(shown.tokens))),
        "ratelimit-reset": String(Math.max(0, Math.ceil((shown.capacity - shown.tokens) / perSecond(shown) + shown.leadSeconds))),
    };
    if (refused)
        headers["retry-after"] = String(retryAfterSeconds(refused));
    return headers;
}
// ---- Vet-link guess limit ----
const MISS_LIMIT = 10;
const MISS_WINDOW_MS = 60_000;
/** Seconds until the oldest counting miss stops counting, or null while fewer than ten misses count. */
export async function guessLimitRetryAfter(address, at) {
    const { rows } = await db.query(`SELECT count(*)::int AS misses, min(missed_at) AS oldest
       FROM (SELECT missed_at FROM vet_link_misses WHERE address = $1 AND missed_at > $2
              ORDER BY missed_at DESC LIMIT $3) recent`, [address, new Date(at - MISS_WINDOW_MS), MISS_LIMIT]);
    const row = first(rows);
    if (row.misses < MISS_LIMIT || !row.oldest)
        return null;
    return Math.max(1, Math.ceil((row.oldest.getTime() + MISS_WINDOW_MS - at) / 1000));
}
export async function recordMiss(client, address, at) {
    await client.query(`INSERT INTO vet_link_misses (address, missed_at) VALUES ($1, $2)`, [address, new Date(at)]);
}
