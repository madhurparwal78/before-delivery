import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newId, hashPassword, verifyPassword } from "../engine/ids.js";
import { instantOf, addSeconds } from "../engine/time.js";


import { readSession, requireDesk, setSessionCookie, clearSessionCookie } from "../app.js";
import { errEmailTaken, errInvalidCredentials, errSessionEnded, errValidation } from "./errors.js";
import { COPY } from "../engine/copy.js";
import { one, rows } from "../db/pool.js";
import { randomBytes } from "node:crypto";
import type { Config } from "../config/env.js";

export function registerDeskRoutes(app: FastifyInstance): void {
  app.get("/api/health", async () => ({ status: "ok" }));

  app.post("/api/sign-up", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown>;
    const name = typeof body?.name === "string" ? body.name : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const fields: Record<string, string> = {};
    if (name.length === 0 || name.length > 120) fields.name = COPY.emptyField;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = COPY.emptyField;
    if (password.length < 10) fields.password = COPY.emptyField;
    if (Object.keys(fields).length > 0) throw errValidation(fields);
    const existing = await one<{ id: string }>(`SELECT id FROM desks WHERE email = $1`, [email]);
    if (existing) throw errEmailTaken();
    const id = newId();
    await rows(
      `INSERT INTO desks (id, name, email, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, name, email, hashPassword(password), instantOf(new Date())],
    );
    const sessionId = await createSession(app.state.config, id);
    setSessionCookie(reply, sessionId);
    reply.status(201);
    return { assessor: { id, name, email } };
  });

  app.post("/api/sign-in", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, unknown>;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (email.length === 0 || password.length === 0) throw errInvalidCredentials();
    const desk = await one<{ id: string; name: string; email: string; password_hash: string }>(
      `SELECT id, name, email, password_hash FROM desks WHERE email = $1`,
      [email],
    );
    if (!desk || !verifyPassword(password, desk.password_hash)) throw errInvalidCredentials();
    const sessionId = await createSession(app.state.config, desk.id);
    setSessionCookie(reply, sessionId);
    return { assessor: { id: desk.id, name: desk.name, email: desk.email } };
  });

  app.post("/api/sign-out", async (req: FastifyRequest, reply: FastifyReply) => {
    const session = await readSession(req);
    if (session.kind !== "live") throw errSessionEnded();
    await rows(`DELETE FROM sessions WHERE id = $1`, [session.sessionId]);
    clearSessionCookie(reply);
    reply.status(204);
    return reply.send(null);
  });

  app.get("/api/session", async (req: FastifyRequest) => {
    const session = await readSession(req);
    if (session.kind !== "live") {
      if (session.kind === "ended") throw errSessionEnded();
      throw errInvalidCredentials();
    }
    const desk = await one<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM desks WHERE id = $1`,
      [session.deskId],
    );
    if (!desk) throw errSessionEnded();
    return { assessor: { id: desk.id, name: desk.name, email: desk.email }, endsAt: session.endsAt };
  });

  app.post("/api/password", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId, sessionId } = await requireDesk(req);
    const body = req.body as Record<string, unknown>;
    const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const next = typeof body?.newPassword === "string" ? body.newPassword : "";
    const fields: Record<string, string> = {};
    if (next.length < 10) fields.newPassword = COPY.emptyField;
    if (Object.keys(fields).length > 0) throw errValidation(fields);
    const desk = await one<{ password_hash: string }>(`SELECT password_hash FROM desks WHERE id = $1`, [deskId]);
    if (!desk || !verifyPassword(current, desk.password_hash)) throw errInvalidCredentials();
    await rows(`UPDATE desks SET password_hash = $1 WHERE id = $2`, [hashPassword(next), deskId]);
    await rows(`DELETE FROM sessions WHERE desk_id = $1 AND id <> $2`, [deskId, sessionId]);
    reply.status(204);
    return reply.send(null);
  });
}

export async function createSession(config: Config, deskId: string): Promise<string> {
  const id = newTokenUrl();
  const endsAt = instantOf(addSeconds(new Date(), config.sessionSeconds));
  await rows(`INSERT INTO sessions (id, desk_id, ends_at) VALUES ($1,$2,$3)`, [id, deskId, endsAt]);
  return id;
}

function newTokenUrl(): string {
  return randomBytes(32).toString("base64url");
}
