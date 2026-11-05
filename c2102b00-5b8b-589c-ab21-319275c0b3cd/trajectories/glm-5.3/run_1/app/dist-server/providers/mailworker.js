"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverSoon = deliverSoon;
exports.startMailWorker = startMailWorker;
const db_1 = require("../db");
const smtp_1 = require("./smtp");
const SENDING_LEASE_SEC = 30;
let running = false;
/** Claims one queued message owned by this process's mail endpoint. */
function claimNext() {
    const nowSec = Math.floor(Date.now() / 1000);
    return (0, db_1.tx)(() => {
        const rows = (0, db_1.all)(`SELECT id FROM emails WHERE status = 'queued' AND endpoint = ?
       AND (sending_until IS NULL OR sending_until < ?)
       ORDER BY id LIMIT 1`, db_1.config.mailEndpoint, nowSec);
        if (rows.length === 0)
            return null;
        const claimed = (0, db_1.run)(`UPDATE emails SET sending_until = ? WHERE id = ? AND status = 'queued'
       AND (sending_until IS NULL OR sending_until < ?)`, nowSec + SENDING_LEASE_SEC, rows[0].id, nowSec);
        return claimed.changes > 0 ? rows[0].id : null;
    });
}
function getEmail(id) {
    const rows = (0, db_1.all)("SELECT to_email, subject, body, message_id FROM emails WHERE id = ?", id);
    return rows[0] ?? null;
}
async function deliverOne(id) {
    const email = getEmail(id);
    if (!email)
        return;
    try {
        await (0, smtp_1.smtpSend)({
            toEmail: email.to_email,
            subject: email.subject,
            body: email.body,
            messageId: email.message_id,
        });
        (0, db_1.tx)(() => {
            (0, db_1.run)("UPDATE emails SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'queued'", Math.floor(Date.now() / 1000), id);
        });
    }
    catch {
        (0, db_1.tx)(() => {
            (0, db_1.run)("UPDATE emails SET failed_attempts = failed_attempts + 1, sending_until = NULL WHERE id = ? AND status = 'queued'", id);
        });
    }
}
/** Delivers every queued message this process owns, one at a time. */
function deliverSoon() {
    if (running)
        return;
    running = true;
    void (async () => {
        try {
            for (;;) {
                const id = claimNext();
                if (id === null)
                    return;
                await deliverOne(id);
            }
        }
        finally {
            running = false;
        }
    })();
}
let workerStarted = false;
function startMailWorker() {
    if (workerStarted)
        return;
    workerStarted = true;
    setInterval(() => {
        deliverSoon();
    }, db_1.config.mailRetrySeconds * 1000);
}
