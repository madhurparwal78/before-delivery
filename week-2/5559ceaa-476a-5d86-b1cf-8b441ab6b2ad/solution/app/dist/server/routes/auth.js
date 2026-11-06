import { randomUUID } from "node:crypto";
import { advanceCheckpoint, blobKey, manifestKey } from "../checkpoints.js";
import { config } from "../config.js";
import { many, one, pool, tx } from "../db.js";
import { ApiError, invalid } from "../errors.js";
import { clearedCookie, COOKIE, cookies, hashToken, newToken, noContent, ok, route, sessionCookie, } from "../http.js";
import { broadcast, broadcastPresence, revoke } from "../hub.js";
import { deliver, signInMessage } from "../mail.js";
import { expired, handBack, landingFor } from "../rules.js";
import { seedSample } from "../seed.js";
import { deleteListed } from "../deletions.js";
import { reachable } from "../storage.js";
import { sessionView, userView } from "../views.js";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ERASED_NAME = "Erased learner";
export function normaliseEmail(raw) {
    return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}
export function validEmail(email) {
    return email.length <= 254 && EMAIL.test(email);
}
export async function issueSignInToken(db, email, userId, inviteProjectId) {
    const token = newToken();
    await db.query("INSERT INTO sign_in_tokens (token_hash, email, user_id, invite_project_id, expires_at) VALUES ($1, $2, $3, $4, $5)", [hashToken(token), email, userId, inviteProjectId, new Date(Date.now() + config.magicLinkTtlSeconds * 1000)]);
    return token;
}
route("POST", "/api/auth/magic-link", async (ctx) => {
    const email = normaliseEmail(ctx.json().email);
    if (!validEmail(email))
        throw invalid({ email: "Enter an email address like name@example.com." });
    const user = await one(pool, "SELECT id FROM users WHERE email = $1", [email]);
    const token = await issueSignInToken(pool, email, user?.id ?? null, null);
    try {
        await deliver(signInMessage(email, token));
    }
    catch {
        await pool.query("DELETE FROM sign_in_tokens WHERE token_hash = $1", [hashToken(token)]);
        throw new ApiError("mail_unavailable");
    }
    return ok({ status: "accepted" }, 202);
}, { auth: false });
route("POST", "/api/auth/verify", async (ctx) => {
    const token = ctx.json().token;
    if (typeof token !== "string" || token === "")
        throw invalid({ token: "Send the sign-in token." });
    const sessionToken = newToken();
    const result = await tx(async (db) => {
        const row = await one(db, "SELECT email, user_id, invite_project_id, expires_at, used_at FROM sign_in_tokens WHERE token_hash = $1 FOR UPDATE", [hashToken(token)]);
        if (!row)
            throw new ApiError("link_not_found");
        if (row.used_at)
            throw new ApiError("link_used");
        if (expired(row.expires_at))
            throw new ApiError("link_expired");
        await db.query("UPDATE sign_in_tokens SET used_at = now() WHERE token_hash = $1", [hashToken(token)]);
        let user = (row.user_id && (await one(db, "SELECT id, email, name, kind FROM users WHERE id = $1", [row.user_id]))) ||
            (await one(db, "SELECT id, email, name, kind FROM users WHERE email = $1", [row.email]));
        let seeded = [];
        if (!user) {
            const created = { id: randomUUID(), email: row.email, name: row.email.split("@")[0], kind: "mentor" };
            await db.query("INSERT INTO users (id, email, name, kind) VALUES ($1, $2, $3, 'mentor')", [created.id, created.email, created.name]);
            seeded = await seedSample(db, created.id, new Date());
            user = created;
        }
        await db.query("INSERT INTO auth_sessions (token_hash, user_id) VALUES ($1, $2)", [hashToken(sessionToken), user.id]);
        return { user, seeded, landing: await landingFor(db, user.id, row.invite_project_id) };
    });
    for (const id of result.seeded)
        void advanceCheckpoint(id).catch((error) => console.error(error));
    return {
        status: 200,
        body: { user: userView(result.user), landing: result.landing },
        headers: { "Set-Cookie": sessionCookie(sessionToken) },
    };
}, { auth: false });
route("POST", "/api/auth/sign-out", async (ctx) => {
    await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(cookies(ctx.req)[COOKIE] ?? "")]);
    return noContent({ "Set-Cookie": clearedCookie() });
});
route("GET", "/api/me", async (ctx) => ok({ user: userView(ctx.user) }));
route("DELETE", "/api/me", async (ctx) => {
    if (ctx.user.kind !== "learner")
        throw new ApiError("forbidden");
    if (ctx.json().confirm !== "ERASE")
        throw invalid({ confirm: "Type ERASE to confirm." });
    if (!(await reachable()))
        throw new ApiError("storage_unavailable");
    const outcome = await erase(ctx.user);
    for (const session of outcome.sessions)
        broadcast(session.project_id, { type: "session", session: sessionView(session) });
    for (const projectId of outcome.projects) {
        revoke(projectId, ctx.user.id);
        void broadcastPresence(projectId).catch(() => undefined);
    }
    await deleteListed();
    return noContent({ "Set-Cookie": clearedCookie() });
});
async function erase(user) {
    return tx(async (db) => {
        const memberships = await many(db, `SELECT m.project_id, p.kind, p.owner_id FROM memberships m JOIN projects p ON p.id = m.project_id
       WHERE m.user_id = $1 AND m.role = 'student' ORDER BY p.id FOR UPDATE OF p`, [user.id]);
        const solo = memberships.filter((m) => m.kind === "one_to_one").map((m) => m.project_id);
        const deletions = solo.map((id) => ({ key: `projects/${id}/`, prefix: true }));
        const authored = await many(db, "SELECT id, project_id FROM checkpoints WHERE created_by = $1 AND NOT (project_id = ANY($2::uuid[]))", [user.id, solo]);
        const projectsWithAuthored = [...new Set(authored.map((c) => c.project_id))];
        const blobsBefore = await many(db, `SELECT DISTINCT c.project_id, f.sha256 FROM checkpoints c JOIN checkpoint_files f ON f.checkpoint_id = c.id
       WHERE c.created_by = $1 AND NOT (c.project_id = ANY($2::uuid[]))`, [user.id, solo]);
        for (const checkpoint of authored)
            deletions.push({ key: manifestKey(checkpoint.project_id, checkpoint.id), prefix: false });
        await db.query("DELETE FROM checkpoints WHERE created_by = $1", [user.id]);
        const stillHeld = new Set((await many(db, `SELECT DISTINCT c.project_id, f.sha256 FROM checkpoints c JOIN checkpoint_files f ON f.checkpoint_id = c.id
           WHERE c.project_id = ANY($1::uuid[])`, [projectsWithAuthored])).map((r) => `${r.project_id}/${r.sha256}`));
        for (const blob of blobsBefore) {
            if (!stillHeld.has(`${blob.project_id}/${blob.sha256}`))
                deletions.push({ key: blobKey(blob.project_id, blob.sha256), prefix: false });
        }
        const sessions = [];
        for (const m of memberships.filter((m) => m.kind !== "one_to_one")) {
            const changed = await handBack(db, m.project_id, user.id);
            if (changed)
                sessions.push(changed);
        }
        const quarantined = await many(db, "SELECT id FROM imports WHERE project_id = ANY($1::uuid[]) AND NOT quarantine_deleted", [solo]);
        for (const plan of quarantined)
            deletions.push({ key: `quarantine/${plan.id}.zip`, prefix: false });
        await db.query("DELETE FROM projects WHERE id = ANY($1::uuid[])", [solo]);
        await db.query(`UPDATE audit_events SET subject = subject || jsonb_build_object('user_id', NULL, 'name', $2::text)
       WHERE subject->>'user_id' = $1::text`, [user.id, ERASED_NAME]);
        await db.query("DELETE FROM outbox WHERE lower(to_address) = $1", [user.email]);
        await db.query("DELETE FROM sign_in_tokens WHERE email = $1", [user.email]);
        await db.query("DELETE FROM users WHERE id = $1", [user.id]);
        for (const deletion of deletions) {
            await db.query("INSERT INTO storage_deletions (key, is_prefix) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [
                deletion.key,
                deletion.prefix,
            ]);
        }
        return { sessions, projects: memberships.map((m) => m.project_id).filter((id) => !solo.includes(id)) };
    });
}
