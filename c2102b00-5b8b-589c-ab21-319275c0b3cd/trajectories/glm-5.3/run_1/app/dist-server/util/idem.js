"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOSE_LEASE_MS = exports.UPLOAD_LEASE_MS = void 0;
exports.hashBody = hashBody;
exports.withIdempotency = withIdempotency;
exports.checkIdempotencyKey = checkIdempotencyKey;
exports.acquireUploadLease = acquireUploadLease;
exports.releaseUploadLease = releaseUploadLease;
exports.acquireCloseLease = acquireCloseLease;
exports.releaseCloseLease = releaseCloseLease;
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const errors_1 = require("../errors");
const CLAIM_LEASE_MS = 30000;
const WAIT_MS = 4500;
const POLL_MS = 40;
function hashBody(body) {
    return (0, node_crypto_1.createHash)("sha256").update(body).digest("hex");
}
/**
 * The single place that decides idempotent replay. Either returns a stored
 * replay, or claims the key so this request may do its work; a concurrent
 * request with the same key waits for the first one's response.
 */
async function withIdempotency(req, work) {
    const bodyHash = hashBody(req.body);
    const claim = () => (0, db_1.tx)(() => {
        const row = (0, db_1.one)("SELECT method, path, body_hash, status, response_body, claimed_at FROM idempotency WHERE person = ? AND key = ?", req.person, req.key);
        if (row) {
            if (row.method !== req.method || row.path !== req.path || row.body_hash !== bodyHash) {
                throw errors_1.errors.idempotencyKeyReused();
            }
            if (row.status !== null && row.response_body !== null) {
                return { kind: "replay", status: row.status, body: row.response_body, replayHeader: true };
            }
            const fresh = Date.now() - row.claimed_at < CLAIM_LEASE_MS;
            if (fresh)
                return "busy";
            (0, db_1.run)("UPDATE idempotency SET claimed_at = ? WHERE person = ? AND key = ?", Date.now(), req.person, req.key);
            return "claimed";
        }
        (0, db_1.run)("INSERT INTO idempotency (person, key, method, path, body_hash, claimed_at, status, response_body) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)", req.person, req.key, req.method, req.path, bodyHash, Date.now());
        return "claimed";
    });
    let first = claim();
    if (first === "busy") {
        const deadline = Date.now() + WAIT_MS;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            first = claim();
            if (first !== "busy")
                break;
        }
        if (first === "busy") {
            // The first request is still running; give up rather than double-work.
            throw errors_1.errors.databaseBusy();
        }
    }
    if (first !== "claimed") {
        return { status: first.status, body: JSON.parse(first.body), replay: true };
    }
    let result;
    try {
        result = await work();
    }
    catch (e) {
        release(req);
        throw e;
    }
    if (result.status < 500) {
        (0, db_1.tx)(() => {
            (0, db_1.run)("UPDATE idempotency SET status = ?, response_body = ? WHERE person = ? AND key = ?", result.status, JSON.stringify(result.body), req.person, req.key);
        });
    }
    else {
        release(req);
    }
    return result;
}
function release(req) {
    try {
        (0, db_1.tx)(() => {
            (0, db_1.run)("DELETE FROM idempotency WHERE person = ? AND key = ? AND status IS NULL", req.person, req.key);
        });
    }
    catch {
        /* nothing to do; the lease expires on its own */
    }
}
function checkIdempotencyKey(key) {
    if (key === undefined || key === null || key === "")
        return errors_1.errors.idempotencyKeyMissing();
    if (!/^[A-Za-z0-9-]{8,64}$/.test(key))
        return errors_1.errors.idempotencyKeyMissing();
    return null;
}
exports.UPLOAD_LEASE_MS = 60000;
exports.CLOSE_LEASE_MS = 60000;
/** One document upload at a time per cycle and kind, across every process. */
function acquireUploadLease(cycleId, kind) {
    const now = Date.now();
    return (0, db_1.tx)(() => {
        const row = (0, db_1.one)("SELECT lease_until FROM upload_locks WHERE cycle_id = ? AND kind = ?", cycleId, kind);
        if (row) {
            if (row.lease_until > now)
                return false;
            (0, db_1.run)("UPDATE upload_locks SET lease_until = ? WHERE cycle_id = ? AND kind = ?", now + exports.UPLOAD_LEASE_MS, cycleId, kind);
            return true;
        }
        (0, db_1.run)("INSERT INTO upload_locks (cycle_id, kind, lease_until) VALUES (?, ?, ?)", cycleId, kind, now + exports.UPLOAD_LEASE_MS);
        return true;
    });
}
function releaseUploadLease(cycleId, kind) {
    try {
        (0, db_1.tx)(() => {
            (0, db_1.run)("DELETE FROM upload_locks WHERE cycle_id = ? AND kind = ?", cycleId, kind);
        });
    }
    catch {
        /* the lease expires on its own */
    }
}
/** One close at a time per cycle, across every process. */
function acquireCloseLease(cycleId) {
    const now = Date.now();
    return (0, db_1.tx)(() => {
        const row = (0, db_1.one)("SELECT lease_until FROM close_locks WHERE cycle_id = ?", cycleId);
        if (row) {
            if (row.lease_until > now)
                return false;
            (0, db_1.run)("UPDATE close_locks SET lease_until = ? WHERE cycle_id = ?", now + exports.CLOSE_LEASE_MS, cycleId);
            return true;
        }
        (0, db_1.run)("INSERT INTO close_locks (cycle_id, lease_until) VALUES (?, ?)", cycleId, now + exports.CLOSE_LEASE_MS);
        return true;
    });
}
function releaseCloseLease(cycleId) {
    try {
        (0, db_1.tx)(() => {
            (0, db_1.run)("DELETE FROM close_locks WHERE cycle_id = ?", cycleId);
        });
    }
    catch {
        /* the lease expires on its own */
    }
}
