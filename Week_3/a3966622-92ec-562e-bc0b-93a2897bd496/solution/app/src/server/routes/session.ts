// Sign-in: seeded accounts only. The session cookie is HttpOnly.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SECRET_WORD, SIGN_IN_FAILED } from "../../shared/signIn.js";
import type { SessionUser } from "../../shared/types.js";
import type { App } from "../app.js";
import { ApiError } from "../errors.js";
import { ok, type Router, SESSION_COOKIE, sessionToken } from "../http.js";
import type { UserRecord } from "../store.js";
import { objectBody } from "../validate.js";

export const hashSecret = (secret: string, salt: string): string => scryptSync(secret, salt, 32).toString("hex");

const sessionBody = (user: UserRecord): { user: SessionUser } => ({
  user: { id: user.id, name: user.name, role: user.role, agency_code: user.agency_code },
});

const matches = (user: UserRecord, secret: string): boolean => {
  const given = Buffer.from(hashSecret(secret, user.salt), "hex");
  const stored = Buffer.from(user.hash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
};

export function sessionRoutes(router: Router, app: App): void {
  router.open("POST", "/api/session", ({ body }) => {
    const fields = objectBody(body);
    const email = typeof fields.email === "string" ? fields.email.trim().toLowerCase() : "";
    const secret = fields[SECRET_WORD];
    const user = app.store.users.by("email", email)[0];
    if (!user || typeof secret !== "string" || !matches(user, secret)) {
      throw new ApiError(401, "invalid_credentials", SIGN_IN_FAILED);
    }
    const token = randomBytes(32).toString("hex");
    app.store.sessions.put({ id: token, user_id: user.id });
    return ok(sessionBody(user), { "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/` });
  });

  router.add("GET", "/api/session", ({ user }) => ok(sessionBody(user)));

  router.add("DELETE", "/api/session", ({ raw }) => {
    const token = sessionToken(raw);
    if (token) app.store.sessions.remove(token);
    return { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` } };
  });
}
