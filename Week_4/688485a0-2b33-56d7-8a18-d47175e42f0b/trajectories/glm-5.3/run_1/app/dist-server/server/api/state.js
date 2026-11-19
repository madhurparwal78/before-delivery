import { readLimitsFromEnv } from "../../shared/config.js";
import { fail } from "../../shared/errors.js";
export function readEnv() {
    const str = (name) => process.env[name] ?? "";
    const port = str("APP_PUBLIC_PORT") || str("PORT") || "4173";
    const forcePathStyle = str("S3_FORCE_PATH_STYLE") === "true";
    return {
        databaseUrl: str("DATABASE_URL"),
        s3: {
            endpoint: str("S3_ENDPOINT"),
            region: str("S3_REGION"),
            bucket: str("S3_BUCKET"),
            forcePathStyle,
            accessKeyId: str("S3_ACCESS_KEY_ID"),
            secretAccessKey: str("S3_SECRET_ACCESS_KEY"),
        },
        smtp: { host: str("SMTP_HOST"), port: Number(str("SMTP_PORT")) || 1025, from: str("MAIL_FROM") },
        publicUrl: str("APP_PUBLIC_URL"),
        gradingKey: process.env.GRADING_KEY || undefined,
        limits: readLimitsFromEnv(),
        port: Number(port) || 4173,
    };
}
/** Cookie sessions: HTTP-only, SameSite=Lax (DP-60, DP-88). */
export const SESSION_COOKIE = "jarful_session";
export function readSessionToken(req) {
    const cookieHeader = req.headers.cookie;
    if (typeof cookieHeader !== "string")
        return null;
    for (const part of cookieHeader.split(";")) {
        const [name, ...rest] = part.trim().split("=");
        if (name === SESSION_COOKIE)
            return rest.join("=");
    }
    return null;
}
export function sessionCookieHeader(token) {
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}
export function clearSessionCookieHeader() {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
/** A person's current role in a project, read on every request (DP-63). */
export async function roleIn(state, projectId, userId) {
    const r = await state.db.query("SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
    return r.rows.length > 0 ? r.rows[0].role : null;
}
/** The caller must be a member; anything else is not_found (DP-64). */
export async function requireRole(state, projectId, userId, min) {
    const role = await roleIn(state, projectId, userId);
    if (role === null)
        fail("not_found", 404);
    const order = { owner: 3, editor: 2, reader: 1 };
    if (order[role] < order[min]) {
        fail(min === "owner" /* Role.Owner */ ? "read_only" : "read_only", 403);
    }
    return role;
}
