// Health, status, limits and sessions.
import { LIMITS } from "../../shared/limits.js";
import { memberById, passwordMatches, sessionCookie, startSession, tokenHash, userBody } from "../auth.js";
import { ApiError } from "../errors.js";
import { SESSION_COOKIE, cookie, jsonBody, member, open } from "../http.js";
import { type Services } from "../services/index.js";

export function sessionRoutes(svc: Services): void {
  open("GET", "/api/health", async () => ({ status: 200, json: { status: "ok" } }));

  open("GET", "/api/status", async () => ({ status: 200, json: svc.status.status }));

  open("GET", "/api/limits", async () => ({ status: 200, json: LIMITS }));

  open("POST", "/api/session", async ({ req }) => {
    const body = jsonBody(req);
    const wrong = new ApiError(401, "invalid_credentials", "Email or password is wrong.");
    if (typeof body.email !== "string" || typeof body.password !== "string") throw wrong;
    const r = await svc.db.query<{ id: string; password_hash: string | null }>(
      "SELECT id, password_hash FROM members WHERE lower(email) = lower($1) AND status = 'active'",
      [body.email.trim()],
    );
    const found = r.rows[0];
    if (!found?.password_hash || !(await passwordMatches(body.password, found.password_hash))) throw wrong;
    const token = await startSession(svc.db, found.id);
    return { status: 200, json: userBody(await memberById(svc.db, found.id)), headers: { "Set-Cookie": sessionCookie(SESSION_COOKIE, token) } };
  });

  member("GET", "/api/session", async ({ member: me }) => ({ status: 200, json: userBody(me) }));

  open("DELETE", "/api/session", async ({ req }) => {
    const token = cookie(req.headers, SESSION_COOKIE);
    if (token) await svc.db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
    return { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
  });
}
