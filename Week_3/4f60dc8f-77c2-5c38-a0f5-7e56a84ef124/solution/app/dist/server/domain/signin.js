// Emailed sign-in codes: the request window, code TTL and tries, and the landing path rule.
import { createHash, randomInt } from "node:crypto";
import { config } from "../config.js";
import { one, transaction } from "../db.js";
import { ApiError, FIELD_COPY, invalid } from "../errors.js";
import { queueEmail } from "../outbox.js";
import { createSession } from "./sessions.js";
const MAX_REQUESTS = 3;
const MAX_WRONG_TRIES = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function validEmail(value) {
    return typeof value === "string" && value.length <= 254 && EMAIL.test(value.trim());
}
const hashCode = (email, code) => createHash("sha256").update(`${email}:${code}`).digest("hex");
/**
 * Counts this request against the rolling window: at most three per email per SIGNIN_CODE_WINDOW_SECONDS. A refused
 * request does not count and answers 429 with Retry-After; known and unknown emails take the same path.
 */
export async function requestCode(rawEmail, now) {
    if (!validEmail(rawEmail))
        throw invalid("email", FIELD_COPY.email);
    const email = rawEmail.trim().toLowerCase();
    const windowMs = config.timers.signinCodeWindow * 1000;
    await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`signin:${email}`]);
        const counted = await client.query("SELECT requested_at FROM signin_code_requests WHERE email = $1 AND requested_at > $2 ORDER BY requested_at", [email, new Date(now.getTime() - windowMs)]);
        const oldest = counted.rows[0]?.requested_at;
        if (counted.rows.length >= MAX_REQUESTS && oldest) {
            const wait = Math.max(1, Math.ceil((oldest.getTime() + windowMs - now.getTime()) / 1000));
            throw new ApiError("too_many_requests", undefined, { "Retry-After": String(wait) });
        }
        await client.query("INSERT INTO signin_code_requests (email, requested_at) VALUES ($1, $2)", [email, now]);
        const contact = await one(client, "SELECT 1 FROM contacts WHERE lower(email) = $1 LIMIT 1", [email]);
        if (!contact)
            return;
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        await client.query(`INSERT INTO signin_codes (email, code_hash, issued_at, wrong_tries, used) VALUES ($1, $2, $3, 0, false)
       ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, issued_at = EXCLUDED.issued_at, wrong_tries = 0, used = false`, [email, hashCode(email, code), now]);
        await queueEmail(client, {
            to: rawEmail.trim(),
            subject: "Your Gloamwork sign-in code",
            text: `Your Gloamwork sign-in code is ${code}.\n\nIt works once and expires in ${Math.round(config.timers.signinCodeTtl / 60) || 1} minutes. If you did not ask for it, you can ignore this email.\n\nGloamwork Studio`,
        });
    });
}
/** `next` when it is a single-slash path with no scheme; otherwise `/account`. */
export function landingPath(next) {
    if (typeof next !== "string" || !next.startsWith("/"))
        return "/account";
    if (next[1] === "/" || next[1] === "\\")
        return "/account";
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(next.slice(1)) || /[\u0000-\u001f]/.test(next))
        return "/account";
    return next;
}
/** Checks the code (single use, five wrong tries, valid up to exactly the TTL) and opens a client session. */
export async function signIn(rawEmail, rawCode, now) {
    if (!validEmail(rawEmail))
        throw new ApiError("code_invalid");
    const email = rawEmail.trim().toLowerCase();
    const code = typeof rawCode === "string" ? rawCode.trim() : "";
    return transaction(async (client) => {
        const stored = await one(client, "SELECT code_hash, issued_at, wrong_tries, used FROM signin_codes WHERE email = $1 FOR UPDATE", [email]);
        const fresh = stored !== null && !stored.used && stored.wrong_tries < MAX_WRONG_TRIES && now.getTime() - stored.issued_at.getTime() <= config.timers.signinCodeTtl * 1000;
        if (!stored || !fresh)
            throw new ApiError("code_invalid");
        if (stored.code_hash !== hashCode(email, code)) {
            await client.query("UPDATE signin_codes SET wrong_tries = wrong_tries + 1 WHERE email = $1", [email]);
            return null;
        }
        await client.query("UPDATE signin_codes SET used = true WHERE email = $1", [email]);
        const contact = await one(client, `SELECT c.name, c.email, b.id AS brand_id, b.name AS brand_name, b.currency FROM contacts c JOIN brands b ON b.id = c.brand_id
       WHERE lower(c.email) = $1 ORDER BY CASE c.role WHEN 'owner' THEN 0 WHEN 'finance' THEN 1 ELSE 2 END LIMIT 1`, [email]);
        if (!contact)
            throw new ApiError("code_invalid");
        const token = await createSession(client, "client", contact.brand_id, contact.email);
        return { token, brand: { id: contact.brand_id, name: contact.brand_name, currency: contact.currency }, contact: { name: contact.name, email: contact.email } };
    }).then((result) => {
        if (!result)
            throw new ApiError("code_invalid");
        return result;
    });
}
