import { randomBytes } from "node:crypto";
import { Router, type RouteCtx, json, sessionCookie, clearSessionCookie } from "./router.js";
import { ApiError } from "../errors.js";
import { z } from "./zod_mini.js";
import { hashToken } from "../auth.js";
import { signInEmailBody } from "../emails.js";
import type { Services } from "../services.js";

export function registerAuthRoutes(router: Router, svc: Services): void {
  router.add("POST", "/api/auth/magic-link", async (ctx: RouteCtx) => {
    const body = z.object({ email: z.string({ min: 1 }) }).parse(ctx.body);
    const email = body.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ApiError("validation", "Enter a valid email address.", {
        fields: { email: "Enter an email address like name@example.com." },
      });
    }
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + svc.cfg.magicLinkTtlSeconds * 1000);
    await svc.pool.query(
      `INSERT INTO auth_tokens (token_hash, email, purpose, expires_at)
       VALUES ($1,$2,'sign_in',$3)`,
      [hashToken(token), email, expires],
    );
    try {
      await svc.mailer.send(email, "Your Relay Bench sign-in link", signInEmailBody(`${svc.cfg.appPublicUrl}/auth/verify?token=${token}`));
    } catch {
      throw new ApiError("mail_unavailable", "Sign-in email can't be sent right now. Try again in a minute.");
    }
    return json(202, { status: "accepted" });
  });

  router.add("POST", "/api/auth/verify", async (ctx: RouteCtx) => {
    const body = z.object({ token: z.string({ min: 1 }) }).parse(ctx.body);
    const token = body.token ?? "";
    const client = await svc.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT email, purpose, project_id, used_at, expires_at FROM auth_tokens
         WHERE token_hash = $1 FOR UPDATE`,
        [hashToken(token)],
      );
      if (r.rowCount === 0) {
        await client.query("ROLLBACK");
        throw new ApiError("link_not_found", "This sign-in link isn't valid. Request a new one.");
      }
      const row = r.rows[0] as {
        email: string; purpose: string; project_id: string | null;
        used_at: Date | null; expires_at: Date;
      };
      const now = new Date();
      if (row.used_at) {
        await client.query("ROLLBACK");
        throw new ApiError("link_used", "This sign-in link has already been used. Request a new one.");
      }
      if (row.expires_at.getTime() <= now.getTime()) {
        await client.query("ROLLBACK");
        throw new ApiError("link_expired", "This sign-in link has expired. Request a new one.");
      }
      let user: { id: string; email: string | null; name: string; kind: string } | null = null;
      const existing = await client.query(
        `SELECT id, email, name, kind FROM users WHERE email = $1`,
        [row.email],
      );
      let newMentor = false;
      let seededCheckpoints: string[] = [];
      if (existing.rowCount === 0) {
        const name = row.email.split("@")[0] ?? row.email;
        const id = crypto.randomUUID();
        const kind = row.purpose === "invite" ? "learner" : "mentor";
        const ins = await client.query(
          `INSERT INTO users (id, email, name, kind) VALUES ($1,$2,$3,$4) RETURNING id, email, name, kind`,
          [id, row.email, name, kind],
        );
        user = ins.rows[0] as { id: string; email: string | null; name: string; kind: string };
        if (kind === "mentor") newMentor = true;
      } else {
        user = existing.rows[0] as { id: string; email: string | null; name: string; kind: string };
      }
      if (newMentor) {
        const seeded = await svc.seed.createSampleWorkspace(client, user.id);
        seededCheckpoints = seeded.checkpointIds;
      }
      await client.query(`UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1`, [hashToken(token)]);
      const sessionId = crypto.randomUUID();
      await client.query(`INSERT INTO sessions_pg (id, user_id) VALUES ($1,$2)`, [sessionId, user.id]);
      const landing = await svc.landingFor(client, user.id, row.purpose, row.project_id);
      await client.query("COMMIT");
      // Upload the seeded checkpoints now that the workspace is committed.
      for (const cpId of seededCheckpoints) {
        try {
          await svc.checkpoints.uploadCheckpoint(cpId);
        } catch {
          // the retry sweep finishes it if storage is unreachable
        }
      }
      return json(200, { user: publicUser(user), landing }, {
        "Set-Cookie": sessionCookie(sessionId),
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });

  router.add("POST", "/api/auth/sign-out", async (ctx: RouteCtx) => {
    const cookies = parseCookieHeader(ctx.req.headers.cookie);
    const token = cookies["rb_session"];
    if (token) {
      await svc.pool.query(`DELETE FROM sessions_pg WHERE id = $1`, [token]);
    }
    return json(204, undefined, { "Set-Cookie": clearSessionCookie() });
  });

  router.add("GET", "/api/me", async (ctx: RouteCtx) => {
    if (!ctx.user) throw new ApiError("unauthenticated", "You need to sign in.");
    return json(200, { user: ctx.user });
  });

  router.add("DELETE", "/api/me", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    if (user.kind === "mentor") {
      throw new ApiError("forbidden", "Mentor accounts cannot be erased.");
    }
    const body = z.object({ confirm: z.string() }).parse(ctx.body);
    if (body.confirm !== "ERASE") {
      throw new ApiError("validation", "Type ERASE to confirm.", {
        fields: { confirm: "Type ERASE to confirm." },
      });
    }
    await svc.erasure.eraseUser(user);
    return json(204, undefined, { "Set-Cookie": clearSessionCookie() });
  });
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function publicUser(u: { id: string; email: string | null; name: string; kind: string }) {
  return { id: u.id, email: u.email, name: u.name, kind: u.kind };
}
