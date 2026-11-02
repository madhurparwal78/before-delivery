import { createHash, randomBytes } from "node:crypto";
import { one, query } from "./db.js";
import { createCrate, resolveCrate } from "./domain/crate.js";
import { ApiError, cookies, setCookie } from "./http.js";
import { addresses } from "./pocketbase.js";
const SESSION_COOKIE = "ceibo_session";
export const CART_COOKIE = "ceibo_cart";
const SESSION_DAYS = 30;
const hash = (token) => createHash("sha256").update(token).digest("hex");
export async function startSession(ctx, user) {
    const token = randomBytes(32).toString("base64url");
    await query(`INSERT INTO sessions (token_hash, user_id, email, name, role, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`, [hash(token), user.id, user.email, user.name, user.role, SESSION_DAYS]);
    setCookie(ctx.res, SESSION_COOKIE, token, SESSION_DAYS * 86400);
}
export async function endSession(ctx) {
    const token = cookies(ctx.req).get(SESSION_COOKIE);
    if (token)
        await query("DELETE FROM sessions WHERE token_hash = $1", [hash(token)]);
    setCookie(ctx.res, SESSION_COOKIE, "", 0);
}
/** The signed-in user, or null. Needs Postgres: an outage is a 503, never a 401. */
export async function currentUser(req) {
    const token = cookies(req).get(SESSION_COOKIE);
    if (!token) {
        await query("SELECT 1");
        return null;
    }
    const row = await one("SELECT user_id, email, name, role FROM sessions WHERE token_hash = $1 AND expires_at > now()", [hash(token)]);
    return row ? { id: row.user_id, email: row.email, name: row.name, role: row.role } : null;
}
const unauthenticated = () => new ApiError(401, "unauthenticated", "Sign in to continue.");
const forbidden = () => new ApiError(403, "forbidden", "Your role can't do that.");
export async function signedIn(ctx) {
    const user = await currentUser(ctx.req);
    if (!user)
        throw unauthenticated();
    return user;
}
export const CUSTOMER = ["customer"];
export const FULFILMENT_TEAM = ["fulfilment", "support", "owner"];
export const TRANSITION_ROLES = ["fulfilment", "owner"];
export const REFUND_ROLES = ["support", "owner"];
export const OWNER = ["owner"];
export function allow(user, roles) {
    if (!roles.includes(user.role))
        throw forbidden();
}
/** The visitor's crate id, creating the crate (and its cookie) on the first cart request. */
export async function crateId(ctx) {
    const cookie = cookies(ctx.req).get(CART_COOKIE);
    const user = await currentUser(ctx.req);
    const customer = user?.role === "customer" ? user : null;
    let id = await resolveCrate(cookie && /^[0-9a-f-]{36}$/.test(cookie) ? cookie : undefined, customer?.id ?? null);
    if (!id) {
        const province = customer
            ? await addresses(customer.id)
                .then((list) => list.find((a) => a.is_default)?.province ?? "ON")
                .catch(() => "ON")
            : "ON";
        id = await createCrate(province, customer?.id ?? null);
    }
    if (id !== cookie)
        setCookie(ctx.res, CART_COOKIE, id, 30 * 86400);
    return id;
}
