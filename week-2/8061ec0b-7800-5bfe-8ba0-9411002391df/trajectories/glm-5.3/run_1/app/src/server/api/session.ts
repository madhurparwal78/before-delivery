// Session endpoints: sign in, current user, sign out.
import type { ApiRequest } from "../http/server.js";
import { clearSessionCookieHeader, sessionCookieHeader } from "../http/server.js";
import type { RouteRegistrar } from "./routes.js";
import { authenticate, createSession, destroySession, type SessionUser } from "../sessions.js";
import { ApiError } from "../errors.js";
import { readBody, readString, requireUser } from "./helpers.js";

export function userBody(user: SessionUser): Record<string, unknown> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    family_id: user.family_id,
    school_id: user.school_id,
  };
}

export function registerSessionRoutes(reg: RouteRegistrar): void {
  reg.add("POST", "/api/session", async (req: ApiRequest) => {
    const body = readBody(req);
    const email = readString(body, "email");
    const password = readString(body, "password");
    if (email === null || password === null) {
      throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
    }
    const user = await reg.db.withTransaction((client) => authenticate(client, email, password));
    if (!user) throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
    const token = await reg.db.withTransaction((client) => createSession(client, user.id, reg.clock.now()));
    return { status: 200, body: { user: userBody(user) }, setCookie: sessionCookieHeader(token) };
  });

  reg.add("GET", "/api/me", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken);
    return { status: 200, body: { user: userBody(user) } };
  });

  reg.add("DELETE", "/api/session", async (req: ApiRequest) => {
    await requireUser(reg.db, req.sessionToken);
    if (req.sessionToken) {
      await reg.db.withTransaction((client) => destroySession(client, req.sessionToken!));
    }
    return { status: 204, body: null, setCookie: clearSessionCookieHeader() };
  });
}
