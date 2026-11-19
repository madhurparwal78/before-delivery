import type { Session } from "../../shared/api.js";
import { digest, newSecret } from "../codes.js";
import { pool } from "../db.js";
import { landing } from "../domain/landing.js";
import { fail, ok, type Reply } from "../http.js";
import { anySession, open, withoutBody, type Route } from "../router.js";
import { SESSION_COOKIE, type Viewer } from "../viewer.js";

const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; SameSite=Lax";
// The session lasts until sign-out or a refund, so the cookie outlives the browser session.
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

const sessionOf = (me: Viewer): Session => ({ role: me.role, name: me.name, id: me.role === "coach" ? me.id : me.enrollmentId });

async function startSession(column: "coach_id" | "enrollment_id", session: Session): Promise<Reply> {
  const token = newSecret();
  await pool.query(`INSERT INTO sessions (token_hash, ${column}) VALUES ($1, $2)`, [digest(token), session.id]);
  return { status: 200, json: session, cookie: `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${COOKIE_MAX_AGE_S}` };
}

export const sessionRoutes: Route[] = [
  open("POST", /^\/api\/session$/, async ({ body }) => {
    if (typeof body.access_code !== "string" || body.access_code === "") throw fail(401, "invalid_code");
    const hash = digest(body.access_code);
    const coach = await pool.query<{ id: string; name: string }>("SELECT id, name FROM coaches WHERE access_code_hash = $1", [hash]);
    const coachRow = coach.rows[0];
    if (coachRow) return startSession("coach_id", { role: "coach", name: coachRow.name, id: coachRow.id });
    const dreamer = await pool.query<{ id: string; name: string; status: string }>(
      "SELECT id, name, status FROM enrollments WHERE access_code_hash = $1",
      [hash],
    );
    const dreamerRow = dreamer.rows[0];
    if (!dreamerRow) throw fail(401, "invalid_code");
    if (dreamerRow.status !== "active") throw fail(403, "enrollment_not_active", { status: dreamerRow.status });
    return startSession("enrollment_id", { role: "dreamer", name: dreamerRow.name, id: dreamerRow.id });
  }),

  anySession("GET", /^\/api\/session$/, async (_ctx, me) => ok(sessionOf(me))),

  withoutBody(anySession("DELETE", /^\/api\/session$/, async (_ctx, me) => {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [me.tokenHash]);
    return { status: 204, cookie: `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0` };
  })),

  anySession("GET", /^\/api\/landing$/, async ({ req }, me) => {
    const next = new URL(req.url ?? "/", "http://app.invalid").searchParams.get("next");
    return ok({ landing: landing(me.role, next) });
  }),
];
