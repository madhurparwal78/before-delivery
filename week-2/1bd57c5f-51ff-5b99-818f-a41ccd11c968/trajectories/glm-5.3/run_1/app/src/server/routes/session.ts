import express, { type Request, type Response } from "express";
import { verifyPassword, hashPassword } from "../identity.js";
import { Errors, FIELD_MESSAGES } from "../errors.js";
import type { Db } from "../db/schema.js";
import { createSession, endOtherSessions, SESSION_COOKIE } from "../context.js";

export function createSessionRouter(db: Db): express.Router {
  const router = express.Router();

  router.post("/session", async (req: Request, res: Response) => {
    const body = req.body as { email?: unknown; password?: unknown };
    const fields: Record<string, string> = {};
    if (typeof body.email !== "string" || body.email.trim() === "") fields.email = "Enter your email.";
    if (typeof body.password !== "string" || body.password === "") fields.password = "Enter your password.";
    if (Object.keys(fields).length > 0) throw Errors.validation(fields);

    const result = await db.query<{ id: string; name: string; email: string; is_owner: boolean; password_hash: string }>(
      `SELECT id, name, email, is_owner, password_hash FROM people WHERE lower(email) = lower($1)`,
      [(body.email as string).trim()],
    );
    const person = result.rows[0];
    if (person === undefined || !(await verifyPassword(body.password as string, person.password_hash))) {
      throw Errors.invalidCredentials();
    }
    const token = await createSession(db, person.id);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
    res.json({ user: { name: person.name, email: person.email, is_owner: person.is_owner } });
  });

  router.delete("/session", async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (token !== undefined) {
      await db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
    }
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  });

  router.get("/me", async (req: Request, res: Response) => {
    if (req.person === undefined) throw Errors.unauthenticated();
    res.json({ user: { name: req.person.name, email: req.person.email, is_owner: req.person.isOwner } });
  });

  router.post("/me/password", async (req: Request, res: Response) => {
    const person = req.person;
    if (person === undefined) throw Errors.unauthenticated();
    const body = req.body as { current_password?: unknown; new_password?: unknown };
    const fields: Record<string, string> = {};
    if (typeof body.current_password !== "string" || body.current_password === "") {
      fields.current_password = "Enter your current password.";
    }
    if (typeof body.new_password !== "string" || body.new_password.length < 10 || body.new_password.length > 200) {
      fields.new_password = FIELD_MESSAGES.newPassword;
    }
    if (Object.keys(fields).length > 0) throw Errors.validation(fields);

    const row = await db.query<{ password_hash: string }>(`SELECT password_hash FROM people WHERE id = $1`, [person.id]);
    const hash = row.rows[0]?.password_hash;
    if (hash === undefined || !(await verifyPassword(body.current_password as string, hash))) {
      throw Errors.validation({ current_password: "That password is wrong." });
    }
    const newHash = await hashPassword(body.new_password as string);
    await endOtherSessions(db, person.id, req.sessionToken ?? "");
    await db.query(`UPDATE people SET password_hash = $1 WHERE id = $2`, [newHash, person.id]);
    res.json({ ok: true });
  });

  return router;
}
