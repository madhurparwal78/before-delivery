import type { Express, Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { errors } from "../errors.js";
import type { Ctx } from "../app.js";
import type { AuthedRequest } from "../api-types.js";
import { readJson } from "../http.js";
import { SESSION_COOKIE, verifyPassword, hashPassword, newSessionToken } from "../auth.js";
import { deskByEmail, deskById, createDesk } from "../repo.js";

/** A signed browser-session cookie claim. */
export function parseCookie(raw: string | undefined, secret: string): { deskId: string; generation: number; exp: number } | null {
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const v = part.slice(eq + 1).trim();
    const dot = v.lastIndexOf(".");
    if (dot === -1) continue;
    const body = v.slice(0, dot);
    const sig = v.slice(dot + 1);
    const expect = createHmac("sha256", secret).update(body).digest("base64url");
    if (expect.length !== sig.length) continue;
    try {
      if (!timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) continue;
    } catch {
      continue;
    }
    try {
      const j = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (typeof j.deskId === "string" && Number.isInteger(j.generation) && typeof j.exp === "number") return j;
    } catch {
      continue;
    }
  }
  return null;
}

export function signCookie(secret: string, deskId: string, generation: number, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ deskId, generation, exp: Date.now() + ttlSeconds * 1000 }), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${SESSION_COOKIE}=${body}.${sig}; Path=/; HttpOnly; SameSite=Lax`;
}

/** Attach the desk for every request, or mark the session ended. */
export function sessionMiddleware(ctx: Ctx): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction) => {
    const claim = parseCookie(req.headers.cookie, ctx.cfg.sessionSecret);
    if (!claim) {
      next();
      return;
    }
    deskById(ctx.db, claim.deskId)
      .then(async (desk) => {
        if (!desk || claim.exp <= Date.now()) {
          (req as AuthedRequest).authEnded = true;
          next();
          return;
        }
        const gen = await ctx.db.query<{ generation: number }>("SELECT generation FROM desks_generation WHERE desk_id=$1", [claim.deskId]);
        const generation = gen.rows[0]?.generation ?? 0;
        if (claim.generation !== generation) {
          (req as AuthedRequest).authEnded = true;
          next();
          return;
        }
        const session = await ctx.db.query("SELECT expires_at FROM sessions WHERE desk_id=$1 AND expires_at > NOW() LIMIT 1", [claim.deskId]);
        if (!session.rows[0]) {
          (req as AuthedRequest).authEnded = true;
          next();
          return;
        }
        (req as AuthedRequest).deskId = desk.id;
        next();
      })
      .catch(next);
  };
}

/** Guard for /api routes that need a session. */
export function requireAuth(req: Request): string {
  const r = req as AuthedRequest;
  if (r.authEnded) throw errors.sessionEnded();
  if (!r.deskId) throw errors.notSignedIn();
  return r.deskId;
}

/** Guard for page routes: what to do about the session. */
export function pageAuthError(req: Request): "none" | "missing" | "ended" {
  const r = req as AuthedRequest;
  if (r.deskId) return "none";
  if (r.authEnded) return "ended";
  return "missing";
}

export function registerAuthApi(app: Express, ctx: Ctx): void {
  app.post("/api/auth/sign-up", async (req: Request, res: Response) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fieldErrors: Record<string, string> = {};
    if (!name) fieldErrors.name = "Enter your name.";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fieldErrors.email = "Enter a real email address.";
    if (password.length < 8) fieldErrors.password = "Enter at least 8 characters.";
    if (Object.keys(fieldErrors).length === 0 && email) {
      const existing = await deskByEmail(ctx.db, email);
      if (existing) throw errors.state("emailTaken", "That email is taken.");
    }
    if (Object.keys(fieldErrors).length) throw errors.invalid(fieldErrors);
    const hash = hashPassword(password);
    const desk = await createDesk(ctx.db, name, email, hash);
    await ctx.db.query("INSERT INTO desks_generation (desk_id, generation) VALUES ($1,0) ON CONFLICT (desk_id) DO NOTHING", [desk.id]);
    await ctx.db.query("INSERT INTO sessions (token, desk_id, created_at, expires_at) VALUES ($1,$2,NOW(),NOW() + ($3 || ' seconds')::interval)", [
      newSessionToken(),
      desk.id,
      String(ctx.cfg.sessionSeconds),
    ]);
    res.setHeader("Set-Cookie", signCookie(ctx.cfg.sessionSecret, desk.id, 0, ctx.cfg.sessionSeconds));
    res.status(201).json({ desk: { id: desk.id, name: desk.name, email: desk.email } });
  });

  app.post("/api/auth/sign-in", async (req: Request, res: Response) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const desk = email ? await deskByEmail(ctx.db, email) : null;
    if (!desk || !desk.passwordHash || !verifyPassword(password, desk.passwordHash)) throw errors.wrongPassword();
    await ctx.db.query("INSERT INTO desks_generation (desk_id, generation) VALUES ($1,0) ON CONFLICT (desk_id) DO NOTHING", [desk.id]);
    const gen = await ctx.db.query<{ generation: number }>("SELECT generation FROM desks_generation WHERE desk_id=$1", [desk.id]);
    const generation = gen.rows[0]?.generation ?? 0;
    await ctx.db.query("INSERT INTO sessions (token, desk_id, created_at, expires_at) VALUES ($1,$2,NOW(),NOW() + ($3 || ' seconds')::interval)", [
      newSessionToken(),
      desk.id,
      String(ctx.cfg.sessionSeconds),
    ]);
    res.setHeader("Set-Cookie", signCookie(ctx.cfg.sessionSecret, desk.id, generation, ctx.cfg.sessionSeconds));
    res.json({ desk: { id: desk.id, name: desk.name, email: desk.email } });
  });

  app.post("/api/auth/sign-out", async (req: Request, res: Response) => {
    const claim = parseCookie(req.headers.cookie, ctx.cfg.sessionSecret);
    if (claim) {
      await ctx.db.query("DELETE FROM sessions WHERE desk_id=$1", [claim.deskId]);
    }
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.status(204).end();
  });

  app.get("/api/auth/session", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const desk = await deskById(ctx.db, deskId);
    if (!desk) throw errors.sessionEnded();
    res.json({ desk: { id: desk.id, name: desk.name, email: desk.email } });
  });

  app.post("/api/auth/password", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const desk = await deskById(ctx.db, deskId);
    if (!desk || !desk.passwordHash) throw errors.sessionEnded();
    const body = (await readJson(req)) as Record<string, unknown>;
    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const next = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!verifyPassword(current, desk.passwordHash)) throw errors.wrongPassword();
    if (next.length < 8) throw errors.invalid({ newPassword: "Enter at least 8 characters." });
    const hash = hashPassword(next);
    await ctx.db.query("UPDATE desks SET password_hash=$1 WHERE id=$2", [hash, deskId]);
    await ctx.db.query(
      "INSERT INTO desks_generation (desk_id, generation) VALUES ($1,1) ON CONFLICT (desk_id) DO UPDATE SET generation=desks_generation.generation+1",
      [deskId]
    );
    const gen = await ctx.db.query<{ generation: number }>("SELECT generation FROM desks_generation WHERE desk_id=$1", [deskId]);
    const generation = gen.rows[0]?.generation ?? 0;
    res.setHeader("Set-Cookie", signCookie(ctx.cfg.sessionSecret, deskId, generation, ctx.cfg.sessionSeconds));
    res.status(204).end();
  });
}
