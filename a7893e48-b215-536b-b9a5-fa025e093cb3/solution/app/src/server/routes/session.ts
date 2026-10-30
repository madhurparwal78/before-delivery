import { CLEARED_COOKIE, endSession, requireActor, signIn, userJson } from "../auth.js";
import { ApiError, field, json, route } from "../http.js";
import { serviceStatus } from "../status.js";
import { pool, one } from "../db.js";

route("GET", "/api/health", async () => json(200, { status: "ok" }));

route("GET", "/api/status", async () => {
  const queued = await one<{ count: number }>(pool, "SELECT count(*)::int AS count FROM emails WHERE sent_at IS NULL");
  return json(200, { billing: serviceStatus.billing, mail: serviceStatus.mail, queued_emails: queued?.count ?? 0 });
});

route("POST", "/api/session", async (request) => {
  const email = field(request.body, "email");
  const password = field(request.body, "password");
  const session = typeof email === "string" && typeof password === "string" ? await signIn(email, password) : null;
  if (!session) throw new ApiError(401, "invalid_credentials");
  return json(200, { user: userJson(session.actor) }, { "Set-Cookie": session.setCookie });
});

route("DELETE", "/api/session", async (request) => {
  await endSession(await requireActor(request));
  return { status: 204, headers: { "Set-Cookie": CLEARED_COOKIE } };
});

route("GET", "/api/me", async (request) => json(200, { user: userJson(await requireActor(request)) }));
