import type { Agency, SessionUser } from "../../shared/api.js";
import { AGENCY, localDateAt, isoAt } from "../agency.js";
import { config } from "../config.js";
import { one } from "../db.js";
import { apiErrors } from "../errors.js";
import { type Reply, clearedSessionCookie, hashToken, newSessionToken, ok, publicRoute, route, sessionCookie, SESSION_LIFETIME_HOURS } from "../http.js";
import { hashPassword, verifyPassword } from "../passwords.js";
import { ACCEPTED_TYPES } from "../services/fileKind.js";
import { MAX_FILES_PER_BOOKING, UPLOAD_LIMIT_BYTES } from "../prep.js";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: SessionUser["role"];
  org_id: string | null;
  password_hash: string;
}

// A fixed hash to check against when the email is unknown, so both failures cost the same.
const UNKNOWN_USER_HASH = hashPassword("no-such-user");

const userJson = (user: SessionUser): SessionUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  org_id: user.org_id,
});

export function registerSessionRoutes(): void {
  publicRoute("GET", "/api/health", async () => ok({ status: "ok" }));

  publicRoute("POST", "/api/session", async (ctx): Promise<Reply> => {
    const body = ctx.json();
    const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
    const password = typeof body["password"] === "string" ? body["password"] : "";
    const user = await one<UserRow>(ctx.db, "SELECT id, name, email, role, org_id, password_hash FROM users WHERE lower(email) = $1", [email]);
    const valid = await verifyPassword(password, user?.password_hash ?? (await UNKNOWN_USER_HASH));
    if (user === null || !valid) throw apiErrors.invalidCredentials();
    await ctx.db.query("DELETE FROM sessions WHERE expires_at < now()");
    const { token, hash } = newSessionToken();
    await ctx.db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))", [
      hash,
      user.id,
      SESSION_LIFETIME_HOURS,
    ]);
    return { status: 200, body: { user: userJson(user) }, headers: { "set-cookie": sessionCookie(token) } };
  });

  route("DELETE", "/api/session", async (ctx): Promise<Reply> => {
    await ctx.db.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(ctx.token ?? "")]);
    return { status: 204, headers: { "set-cookie": clearedSessionCookie } };
  });

  route("GET", "/api/me", async (ctx) => ok(userJson(ctx.user)));

  route("GET", "/api/agency", async (ctx) => {
    const agency: Agency = {
      name: AGENCY.name,
      time_zone: AGENCY.timeZone,
      now: isoAt(ctx.nowMs),
      today: localDateAt(ctx.nowMs),
      solo_threshold_minutes: AGENCY.soloThresholdMinutes,
      open_call_lead_minutes: config.openCallLeadMinutes,
      prep_access_grace_minutes: config.prepAccessGraceMinutes,
      prep_link_ttl_seconds: config.prepLinkTtlSeconds,
      upload_limit_bytes: UPLOAD_LIMIT_BYTES,
      max_files_per_booking: MAX_FILES_PER_BOOKING,
      accepted_types: [...ACCEPTED_TYPES],
    };
    return ok(agency);
  });
}
