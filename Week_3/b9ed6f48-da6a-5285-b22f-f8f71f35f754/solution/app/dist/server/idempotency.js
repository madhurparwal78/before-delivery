// Idempotency keys (brief: API › Idempotency), adapted from kit/modules/idempotency. The key row
// is claimed before the effect; a duplicate in flight on any instance waits for the stored
// response; a reused key with a different request is refused; a 503 is not stored.
import { createHash } from "node:crypto";
import { one, pool } from "./db.js";
import { ApiError, errorBody } from "./http.js";
import { COPY } from "../shared/copy.js";
const KEY = /^[A-Za-z0-9_-]{1,64}$/;
const WAIT_STEP_MS = 100;
const WAIT_LIMIT_MS = 180_000;
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    return JSON.stringify(value ?? null);
}
function fingerprint(ctx) {
    return createHash("sha256").update(`${ctx.req.method}\n${ctx.url.pathname}\n${canonicalJson(ctx.body)}`).digest("hex");
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run(work) {
    try {
        return await work();
    }
    catch (error) {
        if (error instanceof ApiError)
            return { status: error.status, body: errorBody(error) };
        throw error;
    }
}
/** Runs `work` at most once per (user, key); every caller with that key gets the first response. */
export async function idempotent(ctx, userId, work) {
    const key = ctx.req.headers["idempotency-key"];
    if (typeof key !== "string" || !KEY.test(key))
        throw new ApiError(400, "idempotency_key_required", COPY.keyRequired);
    const print = fingerprint(ctx);
    const deadline = Date.now() + WAIT_LIMIT_MS;
    for (;;) {
        const claimed = await one(pool, "INSERT INTO idempotency_keys (user_id, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key", [userId, key, print]);
        if (claimed) {
            let reply;
            try {
                reply = await run(work);
            }
            catch (error) {
                await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key]);
                throw error;
            }
            if (reply.status < 500) {
                await pool.query("UPDATE idempotency_keys SET status = $3, body = $4 WHERE user_id = $1 AND key = $2", [userId, key, reply.status, JSON.stringify(reply.body ?? null)]);
            }
            else {
                await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key]);
            }
            return reply;
        }
        const stored = await one(pool, "SELECT fingerprint, status, body FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key]);
        if (stored && stored.fingerprint !== print)
            throw new ApiError(409, "idempotency_conflict", COPY.keyConflict);
        if (stored && stored.status !== null) {
            return { status: stored.status, body: stored.body ?? undefined, headers: { "Idempotent-Replayed": "true" } };
        }
        if (Date.now() > deadline)
            throw new ApiError(409, "idempotency_conflict", COPY.keyConflict);
        await sleep(WAIT_STEP_MS);
    }
}
