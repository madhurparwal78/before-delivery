// Idempotency keys for visit close, invoice payments, payment capture, void and refund, and import, claimed
// atomically in Postgres with a lease before any call to Kill Bill or any email is queued (brief: Business rules,
// Idempotency). Adapted from kit/modules/idempotency: canonical JSON fingerprints and a (caller, route, key) row.
import { createHash } from "node:crypto";
import { now, plusSeconds } from "./clock.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { ApiError, conflict } from "./errors.js";
/** Keys sorted at every depth, no whitespace: bodies compare as parsed JSON. */
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
    }
    return typeof value === "symbol" ? '"<unparsable>"' : (JSON.stringify(value) ?? "null");
}
/**
 * Runs `work` once per (caller, route, key). A finished request's status and body replay exactly, refusals
 * included; a live in-flight claim answers idempotency_in_progress; an expired claim is taken over and finished;
 * a different body under the same key answers idempotency_conflict.
 */
export async function idempotent(ctx, work) {
    const header = ctx.req.headers["idempotency-key"];
    const key = (Array.isArray(header) ? header[0] : header)?.trim();
    if (!key)
        throw new ApiError(400, "idempotency_key_required");
    const actor = ctx.caller.token ? `token:${ctx.caller.token.id}` : `user:${ctx.caller.id}`;
    const route = `${ctx.req.method ?? ""} ${new URL(ctx.req.url ?? "/", "http://app.invalid").pathname}`;
    const material = ctx.raw.length ? ctx.raw : Buffer.from(canonicalJson(ctx.body));
    const fingerprint = createHash("sha256").update(material).digest("hex");
    const at = now();
    const lease = plusSeconds(at, config.idempotencyLeaseSeconds);
    const ids = [actor, route, key];
    const claimed = await db.query(`INSERT INTO idempotency_keys (actor, route, key, fingerprint, lease_expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`, [...ids, fingerprint, lease, new Date(at)]);
    let takeover = false;
    if (claimed.rowCount === 0) {
        const { rows } = await db.query(`SELECT fingerprint, status_code, response_body, lease_expires_at FROM idempotency_keys
        WHERE actor = $1 AND route = $2 AND key = $3`, ids);
        const stored = rows[0];
        if (!stored || stored.fingerprint !== fingerprint)
            throw conflict("idempotency_conflict");
        if (stored.status_code !== null)
            return { status: stored.status_code, json: JSON.parse(stored.response_body ?? "null") };
        const taken = await db.query(`UPDATE idempotency_keys SET lease_expires_at = $4
        WHERE actor = $1 AND route = $2 AND key = $3 AND status_code IS NULL AND lease_expires_at <= $5`, [...ids, lease, new Date(at)]);
        if (taken.rowCount === 0)
            throw conflict("idempotency_in_progress");
        takeover = true;
    }
    let reply;
    try {
        reply = await work({ key, takeover });
    }
    catch (error) {
        if (!(error instanceof ApiError)) {
            await db.query(`DELETE FROM idempotency_keys WHERE actor = $1 AND route = $2 AND key = $3 AND status_code IS NULL`, ids);
            throw error;
        }
        reply = { status: error.status, json: error.body(), headers: error.headers };
    }
    await db.query(`UPDATE idempotency_keys SET status_code = $4, response_body = $5 WHERE actor = $1 AND route = $2 AND key = $3`, [
        ...ids,
        reply.status,
        JSON.stringify(reply.json ?? null),
    ]);
    return reply;
}
