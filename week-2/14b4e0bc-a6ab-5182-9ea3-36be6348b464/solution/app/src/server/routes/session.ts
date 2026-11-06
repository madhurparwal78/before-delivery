import { newSessionToken, tokenHash, verifyPassword } from "../auth.ts";
import { pool } from "../db.ts";
import { ApiError, inPrecedence, invalid } from "../errors.ts";
import { hub } from "../events.ts";
import type { Route } from "../http.ts";
import { parseCookies } from "../http.ts";
import { queuedCount } from "../notices.ts";
import { services } from "../status.ts";

const COOKIE = "strata_session";

function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

const user = (r: { id: string; name: string; email: string; role: string }) => ({ id: r.id, name: r.name, email: r.email, role: r.role });

export const sessionRoutes: Route[] = [
  {
    method: "POST",
    pattern: "/api/session",
    open: true,
    async handler(ctx) {
      const body = ctx.json();
      const { rows } = await pool.query("select id, name, email, role, password_hash from users where email = $1", [
        typeof body.email === "string" ? body.email : "",
      ]);
      const found = rows[0];
      if (!found || typeof body.password !== "string" || !(await verifyPassword(body.password, found.password_hash))) {
        throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
      }
      const token = newSessionToken();
      const previous = parseCookies(ctx.req.headers.cookie)[COOKIE];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (previous) await client.query("delete from sessions where token_hash = $1", [tokenHash(previous)]);
        await client.query("insert into sessions(token_hash, user_id) values ($1, $2)", [tokenHash(token), found.id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return { status: 200, body: { user: user(found) }, headers: { "Set-Cookie": sessionCookie(token) } };
    },
  },
  {
    method: "GET",
    pattern: "/api/session",
    async handler(ctx) {
      return { status: 200, body: { user: user(ctx.actor) } };
    },
  },
  {
    method: "DELETE",
    pattern: "/api/session",
    async handler(ctx) {
      await pool.query("delete from sessions where token_hash = $1", [ctx.actor.tokenHash]);
      return { status: 204, headers: { "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` } };
    },
  },
  {
    method: "GET",
    pattern: "/api/health",
    open: true,
    async handler() {
      return { status: 200, body: { status: "ok" } };
    },
  },
  {
    method: "GET",
    pattern: "/api/status",
    async handler() {
      return { status: 200, body: { evidence: services.evidence, mail: services.mail, queued_notices: await queuedCount() } };
    },
  },
  {
    method: "GET",
    pattern: "/api/events",
    async handler(ctx) {
      const header = ctx.req.headers["last-event-id"];
      const raw = typeof header === "string" ? header : ctx.url.searchParams.get("after_seq");
      await inPrecedence({
        validation() {
          if (raw !== null && !/^\d+$/.test(raw)) throw invalid({ after_seq: "Use a non-negative whole number." });
        },
      });
      ctx.res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      // Optional X-Stream-Window (whole seconds, 1-300): the stream ends cleanly after it, so a
      // screen's page can fall quiet between windows and resume from the closing id.
      const windowHeader = ctx.req.headers["x-stream-window"];
      const windowSeconds = typeof windowHeader === "string" && /^\d{1,3}$/.test(windowHeader) ? Number(windowHeader) : 0;
      ctx.res.write(": connected\n\n");
      await hub.open(ctx.actor, ctx.res, raw === null ? null : Number(raw), windowSeconds >= 1 && windowSeconds <= 300 ? windowSeconds * 1000 : null);
      return null;
    },
  },
];
