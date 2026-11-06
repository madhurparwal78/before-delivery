import { createHash } from "node:crypto";
import { one, query } from "../db.js";
import { ApiError, storeUnavailable } from "../http.js";
// Idempotency keys (adapted from kit/modules/idempotency): one row per (caller, key), inserted
// before the effect; a replay with the same fingerprint returns the stored answer.
function canonicalJson(value) {
    if (value === undefined || value === null)
        return "null";
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (typeof value === "object") {
        return `{${Object.keys(value)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
export function fingerprint(method, path, body) {
    return createHash("sha256").update(`${method}\n${path}\n${canonicalJson(body)}`).digest("hex");
}
const KEEP_HOURS = 24;
const WAIT_MS = 30_000;
/** Starts an attempt, or answers a finished one; a different body under the same key is refused. */
export async function beginAttempt(scope, key, print) {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
        await query(`DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND created_at < now() - make_interval(hours => $3)`, [scope, key, KEEP_HOURS]);
        const inserted = await query(`INSERT INTO idempotency_keys (scope, key, fingerprint, status) VALUES ($1, $2, $3, 'running')
       ON CONFLICT (scope, key) DO NOTHING RETURNING key`, [scope, key, print]);
        if (inserted.length === 1)
            return { kind: "new" };
        const stored = await one("SELECT fingerprint, status, response_status, response_body FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key]);
        if (stored) {
            if (stored.fingerprint !== print) {
                throw new ApiError(409, "idempotency_mismatch", "This key was already used with a different request.");
            }
            if (stored.status === "done")
                return { kind: "replay", status: stored.response_status, body: stored.response_body };
        }
        if (Date.now() > deadline)
            throw storeUnavailable();
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}
export async function finishAttempt(scope, key, status, body) {
    await query("UPDATE idempotency_keys SET status = 'done', response_status = $3, response_body = $4 WHERE scope = $1 AND key = $2", [scope, key, status, JSON.stringify(body)]);
}
/** A 503 is never stored: the key is released so a retry completes the work. */
export async function abandonAttempt(scope, key) {
    await query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND status = 'running'", [scope, key]).catch(() => undefined);
}
