import { randomBytes, scryptSync, timingSafeEqual, randomInt } from "node:crypto";
/**
 * Accounts and sessions (DP-59, DP-60): scrypt password hashing, one active
 * six-digit code per address, HTTP-only session cookies.
 */
export function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 32).toString("hex");
    return `${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash)
        return false;
    const test = scryptSync(password, salt, 32);
    const expected = Buffer.from(hash, "hex");
    return test.length === expected.length && timingSafeEqual(test, expected);
}
export function newToken() {
    return randomBytes(32).toString("hex");
}
/** A six-digit sign-up code. */
export function newCode() {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
export async function findUserByEmail(db, email) {
    const r = await db.query("SELECT id, email, name, password_hash, confirmed FROM users WHERE email = $1", [email]);
    return r.rows.length > 0 ? r.rows[0] : null;
}
export async function findUserById(db, id) {
    const r = await db.query("SELECT id, email, name FROM users WHERE id = $1", [id]);
    return r.rows.length > 0 ? r.rows[0] : null;
}
export async function createSession(db, userId) {
    const token = newToken();
    await db.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
    return token;
}
export async function sessionUser(db, token) {
    const r = await db.query("SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1", [token]);
    return r.rows.length > 0 ? r.rows[0] : null;
}
export async function destroySession(db, token) {
    await db.query("DELETE FROM sessions WHERE token = $1", [token]);
}
export function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
