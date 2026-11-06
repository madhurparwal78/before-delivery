import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import { afterCommit, query, rows } from "./db.js";
// Every email goes into the Postgres outbox first, then a process that can reach the mail
// server sends it exactly once (the row is claimed before sending).
const fromAddress = (/<([^>]+)>/.exec(config.mail.from)?.[1] ?? config.mail.from).trim();
function encodeHeader(value) {
    return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}
function message(to, subject, body) {
    const text = body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    return [
        `From: ${encodeHeader(config.mail.from)}`,
        `To: ${to}`,
        `Subject: ${encodeHeader(subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${randomUUID()}@ceibo.test>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        text,
        ".",
        "",
    ].join("\r\n");
}
/** A minimal SMTP conversation (EHLO, MAIL, RCPT, DATA, QUIT); Mailpit needs no auth. */
function smtpSend(to, raw) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: config.mail.smtpHost, port: config.mail.smtpPort });
        socket.setTimeout(10_000, () => socket.destroy(new Error("SMTP timeout")));
        const steps = [`EHLO ceibo.test`, `MAIL FROM:<${fromAddress}>`, `RCPT TO:<${to}>`, "DATA", raw, "QUIT"];
        const expected = [220, 250, 250, 250, 354, 250, 221];
        let step = 0;
        let buffer = "";
        socket.on("data", (chunk) => {
            buffer += chunk.toString("utf8");
            const lines = buffer.split("\r\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (/^\d{3}-/.test(line))
                    continue;
                const code = Number(line.slice(0, 3));
                if (code !== expected[step]) {
                    socket.destroy();
                    reject(new Error(`SMTP ${line}`));
                    return;
                }
                if (step === steps.length) {
                    socket.end();
                    resolve();
                    return;
                }
                socket.write(steps[step] === raw ? raw : `${steps[step]}\r\n`);
                step += 1;
            }
        });
        socket.on("error", reject);
        socket.on("close", () => reject(new Error("SMTP closed")));
    });
}
export async function enqueueMail(client, to, subject, body) {
    const sql = "INSERT INTO outbox (to_address, subject, body) VALUES ($1, $2, $3)";
    if (client) {
        await rows(client, sql, [to, subject, body]);
        afterCommit(client, () => void sendOutbox());
    }
    else {
        await query(sql, [to, subject, body]);
        void sendOutbox();
    }
}
let sending = false;
let retryAt = 0;
/** Claims and sends unsent mail; a failed send gives its claim back at once and retries in 10 s. */
export async function sendOutbox() {
    if (sending || Date.now() < retryAt)
        return;
    sending = true;
    try {
        for (;;) {
            const [claimed] = await query(`UPDATE outbox SET claimed_until = now() + interval '30 seconds'
         WHERE id = (SELECT id FROM outbox WHERE sent_at IS NULL AND (claimed_until IS NULL OR claimed_until < now())
                     ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id, to_address, subject, body`);
            if (!claimed)
                return;
            try {
                await smtpSend(claimed.to_address, message(claimed.to_address, claimed.subject, claimed.body));
            }
            catch {
                await query("UPDATE outbox SET claimed_until = NULL WHERE id = $1", [claimed.id]);
                retryAt = Date.now() + 10_000;
                return;
            }
            await query("UPDATE outbox SET sent_at = now(), claimed_until = NULL WHERE id = $1", [claimed.id]);
        }
    }
    catch {
        // Postgres is unreachable; the outbox waits for it.
    }
    finally {
        sending = false;
    }
}
export async function probeMail() {
    try {
        const response = await fetch(`${config.mail.mailpitUrl}/readyz`, { signal: AbortSignal.timeout(2500) });
        return response.status === 200;
    }
    catch {
        return false;
    }
}
